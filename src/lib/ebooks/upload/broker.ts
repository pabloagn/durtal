import { PostgresSpoolAllocationAuthority } from "./allocation-authority";
import { expectedPartBytes, partCount, requireCompleteParts } from "./parts";
import { requireSha256, requireUuid } from "./runtime-contract";
import { uploadPartKey, uploadPartPath, type PostgresUploadStore } from "./store";
import type { PrivateUploadSpool } from "./private-spool";
import type { UploadSupervisor, SupervisorOwner } from "./supervisor";
import type { OperationFence } from "./lifecycle";
import type { UploadCoreAdapter, UploadCoreContext } from "./core-contract";
import { createUploadBatchSchema, uploadBatchViewSchema, uploadCommandSchema, uploadOutcomeSchema, UploadError,
  uploadItemViewSchema, type UploadBatchView, type UploadItemView, type UploadCommand, type UploadOutcome } from "./protocol";
import { canonicalJson } from "./idempotency";
import { UploadAdmissionRefusal } from "./admission-refusal";
import { UPLOAD_BROKER_KEY } from "./availability";

/** The app receives this port; spool, supervisor and engine access stay in the
 * owned service process. The authenticated Unix bridge implements the same port.
 */
export interface UploadGateway {
  ready(): boolean | Promise<boolean>;
  /** Why uploads will be refused right now, for the upload page to say before a file is chosen */
  notice?(): Promise<string | null>;
  create(input: unknown, channel: UploadCoreContext["channel"]): Promise<UploadBatchView>;
  batch(id: string, channel: UploadCoreContext["channel"]): Promise<UploadBatchView>;
  item(id: string, channel: UploadCoreContext["channel"]): Promise<UploadItemView>;
  command(id: string, input: unknown, channel: UploadCoreContext["channel"]): Promise<UploadOutcome>;
  part(input: { id: string; generation: number; number: number; sha256: string; body: ReadableStream<Uint8Array> }): Promise<{
    number: number; bytes: number; sha256: string; generation: number;
  }>;
}

/** App-mode byte transport uses the actual owned supervisor/store/private spool.
 * It never inserts or updates catalogue, matching or annotation rows itself.
 */
export class UploadBroker implements UploadGateway {
  constructor(private readonly input: {
    supervisor: UploadSupervisor; store: PostgresUploadStore; spool: PrivateUploadSpool;
    core: UploadCoreAdapter; targetFingerprint: string; bindingSha256: string;
  }) { requireSha256(input.targetFingerprint); requireSha256(input.bindingSha256); }

  private context(channel: UploadCoreContext["channel"]): UploadCoreContext {
    return { channel, targetFingerprint: this.input.targetFingerprint, bindingSha256: this.input.bindingSha256 };
  }
  private owner(): SupervisorOwner {
    const ready = this.input.supervisor.readiness();
    if (ready.state !== "ready" || ready.owner.bindingSha256 !== this.input.bindingSha256)
      throw new UploadError(503, "upload_unavailable", "Uploads are waiting for the owned worker to recover.");
    return ready.owner;
  }
  private fence(owner: SupervisorOwner, id: string, generation: number): OperationFence {
    requireUuid(id); return { operationId: id, generation, ownerToken: owner.ownerToken, ownerFence: owner.ownerFence };
  }
  private authority(owner: SupervisorOwner, sourceBytes: number, relativePath: string) {
    return new PostgresSpoolAllocationAuthority({ store: this.input.store, sourceBytes, relativePath,
      owner: () => { const current = this.owner(); if (current.ownerToken !== owner.ownerToken || current.ownerFence !== owner.ownerFence)
        throw new UploadError(409, "generation_changed", "The worker restarted; refresh this upload before continuing."); return current; } });
  }
  ready(): boolean { try { this.owner(); return true; } catch { return false; } }

  async create(input: unknown, channel: UploadCoreContext["channel"]) {
    // Actual core checks permanent creation replay before current readiness.
    const request = createUploadBatchSchema.parse(input);
    const created = uploadBatchViewSchema.parse(await this.input.core.createBatch(request, this.context(channel)));
    if (created.key !== request.key || created.items.length !== request.files.length || created.items.some((item, index) => {
      const source = request.files[index]; return item.name !== source.name || item.bytes !== source.bytes || item.sha256 !== source.sha256
        || canonicalJson(item.target) !== canonicalJson(source.target);
    })) throw new Error("Creation receipt differs from its original request"); return created;
  }
  async batch(id: string, channel: UploadCoreContext["channel"]) {
    requireUuid(id); const result = await this.input.core.readBatch(id, this.context(channel));
    if (!result) throw new UploadError(404, "upload_not_found", "Upload batch not found.");
    return uploadBatchViewSchema.parse(result);
  }
  async item(id: string, channel: UploadCoreContext["channel"]) {
    requireUuid(id); const result = await this.input.core.readItem(id, this.context(channel));
    if (!result) throw new UploadError(404, "upload_not_found", "Upload item not found.");
    const item = uploadItemViewSchema.parse(result); if (item.id !== id) throw new Error("Upload item scope differs"); return item;
  }
  async admit(id: string, generation: number, key: string): Promise<void> {
    requireUuid(key);
    const owner = this.owner(); const fence = this.fence(owner, id, generation);
    const view = await this.input.store.uploadView(owner, id);
    if (view.generation !== generation) throw new UploadAdmissionRefusal({ status: 409, code: "generation_changed", action: "admit", operationId: id, key, generation });
    if (view.state === "queued") await this.input.supervisor.io.barrier(async () => {
      const inventory = await this.input.spool.inventory();
      const revision = await this.input.store.capacityRevision(owner);
      await this.input.store.admit(owner, fence, { sourceBytes: view.sourceBytes, revision, measuredAt: Date.now(), inventory });
    });
    else if (!["admitted", "receiving"].includes(view.state)) throw new UploadError(409, "upload_not_receiving", "This upload is no longer receiving bytes.");
    const relativePath = `${id}/metadata/directories`;
    await this.input.spool.prepareDirectories({ fence, gate: this.input.supervisor.io,
      authority: this.authority(owner, view.sourceBytes, relativePath) });
  }
  async part(input: { id: string; generation: number; number: number; sha256: string; body: ReadableStream<Uint8Array> }) {
    requireSha256(input.sha256);
    const owner = this.owner(); const fence = this.fence(owner, input.id, input.generation);
    const stored = await this.input.store.transport(owner, fence);
    const bytes = expectedPartBytes(stored.sourceBytes, input.number); const key = uploadPartKey(input.number);
    if (stored.transport.corrupt) throw new UploadError(409, "upload_corrupt", "The retained upload needs recovery before more bytes can be accepted.");
    const saved = stored.transport.parts[key];
    if (saved) {
      await input.body.cancel();
      if (saved.sha256 !== input.sha256) throw new UploadError(409, "part_changed", "These bytes differ from the retained part.");
      return { number: input.number, ...saved, generation: input.generation };
    }
    const relativePath = uploadPartPath(input.id, input.number);
    const grantKey = `parts/${key}`;
    if (stored.transport.grants[grantKey]) {
      await input.body.cancel();
      if (stored.transport.writers[grantKey]) throw new UploadError(409, "part_pending", "This part is still settling. Refresh before retrying.");
      const verified = await this.input.spool.verifyRetainedFile(relativePath, bytes, { fence, gate: this.input.supervisor.io });
      if (verified.sha256 !== input.sha256) throw new UploadError(409, "part_changed", "The retained partial bytes differ; cancel or recover this upload.");
      await this.input.store.acknowledgePart(owner, fence, { number: input.number, ...verified });
      return { number: input.number, ...verified, generation: input.generation };
    }
    const receipt = await this.input.spool.writeExclusive({ fence, relativePath, bytes, expectedSha256: input.sha256,
      stream: input.body, gate: this.input.supervisor.io, authority: this.authority(owner, stored.sourceBytes, relativePath) });
    await this.input.store.acknowledgePart(owner, fence, { number: input.number, ...receipt });
    return { number: input.number, ...receipt, generation: input.generation };
  }
  private async assemble(id: string, command: Extract<UploadCommand, { action: "complete" }>) {
    const owner = this.owner(); const fence = this.fence(owner, id, command.generation);
    const stored = await this.input.store.transport(owner, fence);
    if (stored.input.sha256 !== command.sha256 || stored.transport.corrupt) throw new UploadError(409, "source_changed", "The original upload checksum differs.");
    if (stored.transport.assembled) {
      if (stored.transport.assembled.sha256 !== command.sha256) throw new UploadError(409, "source_changed", "The assembled source differs.");
      return;
    }
    const receipts = Object.entries(stored.transport.parts).map(([number, part]) => ({ number: Number(number), ...part }));
    const parts = { generation: command.generation, sourceBytes: stored.sourceBytes, receipts };
    requireCompleteParts(parts, command.generation);
    if (receipts.length !== partCount(stored.sourceBytes)) throw new UploadError(409, "upload_incomplete", "Send all parts before completing the upload.");
    const relativePath = `${id}/assembled/source`;
    const existing = stored.transport.grants["assembled/source"];
    const receipt = existing
      ? await (async () => {
        if (stored.transport.writers["assembled/source"]) throw new UploadError(409, "assembly_pending", "Source assembly is still settling.");
        return this.input.spool.verifyRetainedFile(relativePath, stored.sourceBytes, { fence, gate: this.input.supervisor.io });
      })()
      : await this.input.spool.assemble({ fence, parts, expectedSha256: command.sha256, gate: this.input.supervisor.io,
        authority: this.authority(owner, stored.sourceBytes, relativePath) });
    if (receipt.sha256 !== command.sha256) throw new UploadError(409, "source_changed", "The retained source differs.");
    await this.input.store.acknowledgeAssembly(owner, fence, receipt);
  }
  async command(id: string, input: unknown, channel: UploadCoreContext["channel"]): Promise<UploadOutcome> {
    requireUuid(id); const command = uploadCommandSchema.parse(input); const context = this.context(channel);
    const replay = await this.input.core.replayCommand(id, command, context);
    if (replay) { const result = uploadOutcomeSchema.parse(replay); if (result.key !== command.key) throw new Error("Replayed upload key differs");
      if (command.action === "cancel" && result.status < 300) this.input.supervisor.cancelJob(id);
      return result; }
    if (command.action === "admit") await this.admit(id, command.generation, command.key);
    if (command.action === "complete") await this.assemble(id, command);
    const result = uploadOutcomeSchema.parse(await this.input.core.command(id, command, context));
    if (result.key !== command.key) throw new Error("Upload receipt key differs");
    if (command.action === "cancel" && result.status < 300) this.input.supervisor.cancelJob(id);
    return result;
  }
}

const registryKey = UPLOAD_BROKER_KEY;
/** Explicit owned-service composition only. No import-side startup or fallback. */
export function installUploadBroker(broker: UploadGateway): void {
  const registry = globalThis as unknown as Record<symbol, unknown>;
  if (registry[registryKey]) throw new Error("Upload broker is already installed");
  registry[registryKey] = broker;
}
export function uploadBroker(): UploadGateway {
  const broker = (globalThis as unknown as Record<symbol, UploadGateway | undefined>)[registryKey];
  if (!broker) throw new UploadError(503, "upload_unavailable", "Uploads are not available on this server yet.");
  return broker;
}
