import path from "node:path";
import { randomUUID } from "node:crypto";
import { stageFile } from "../medallion";
import { storable } from "../ingest/metadata";
import { storeObject, type StoreInput, type StoreOptions } from "../ingest/store";
import { verifyPublication } from "../publication";
import { boundedJsonBytes } from "./bounded-json";
import { PostgresSpoolAllocationAuthority } from "./allocation-authority";
import { decodePublishedInspection } from "./published-inspection";
import { writeInspectorRequest } from "./worker-request";
import { requestRelativePath } from "./runtime-contract";
import { UPLOAD_LIMITS } from "./limits";
import { canonicalJson } from "./idempotency";
import { CHECK_FAILURES_BEFORE_OUTAGE, UploadChecksFailing, UploadItemFailed } from "./job-failure";
import type { UploadSupervisor, UploadJobScope } from "./supervisor";
import type { PostgresUploadStore } from "./store";
import type { PrivateUploadSpool } from "./private-spool";
import type { UploadJobCoreAdapter } from "./job-contract";
import type { UploadCoreContext } from "./core-contract";

/** One dispatcher per physical owned worker. No startup on import, no alternate
 * parser, object writer, core writer or detached receipt promise.
 */
export class UploadDispatcher {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private enabled = false;
  /** Checks that failed in a row; a refusal or a published file means the inspector works */
  private checkFailures = 0;
  constructor(private readonly input: {
    supervisor: UploadSupervisor; store: PostgresUploadStore; spool: PrivateUploadSpool;
    core: UploadJobCoreAdapter; context: UploadCoreContext; onFailure(error: unknown): void;
    /** One item failed and was recorded; the service carries on (SLN-1388) */
    onItemFailure?(error: UploadItemFailed): void;
  }) {}

  start(): void {
    if (this.enabled || this.running) throw new Error("Upload dispatcher already started");
    if (this.input.supervisor.readiness().state !== "ready") throw new Error("Upload worker is not ready");
    this.enabled = true; this.schedule(0);
  }
  async stop(): Promise<void> {
    this.closeAdmissions();
    // The supervisor stop aborts and bounds settlement. Do not race the job
    // promise and release physical ownership while host publication is active.
    await this.running?.catch(() => {}); // failure was reported; await actual settlement
  }
  closeAdmissions(): void { this.enabled = false; clearTimeout(this.timer); this.timer = undefined; }
  private schedule(delay: number): void {
    if (!this.enabled) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const running = this.dispatchOne(); this.running = running;
      void running.catch((error) => { this.enabled = false; this.input.onFailure(error); }).finally(() => {
        if (this.running === running) this.running = null;
        this.schedule(1000);
      });
    }, delay);
  }
  /** Public for a source-only mock regression packet; never starts a listener. */
  async dispatchOne(): Promise<void> {
    const ready = this.input.supervisor.readiness();
    if (ready.state !== "ready") throw new Error("Upload worker readiness lost");
    try {
      if (await this.runNext()) this.checkFailures = 0;
    } catch (error) {
      if (!(error instanceof UploadItemFailed)) throw error;
      try { this.input.onItemFailure?.(error); } catch { /* Diagnostics cannot fail the next job. */ }
      if (error.canceled) return;
      if (error.failure.reason !== "check_failed") { this.checkFailures = 0; return; }
      // Stopping makes the app say the service is down, rather than failing every file in turn (SLN-1467)
      if (++this.checkFailures >= CHECK_FAILURES_BEFORE_OUTAGE) throw new UploadChecksFailing({ cause: error });
    }
  }

  /** Whether a file was checked and published; false when none was waiting */
  private async runNext(): Promise<boolean> {
    return await this.input.supervisor.runNextJob((owner) => this.input.store.claimNext(owner, randomUUID(), this.input.context.targetFingerprint), {
      prepare: async (scope) => {
        const fence = scope.identity.fence;
        const owner = await scope.current();
        await this.input.core.assertInspectionCurrent(scope.identity, this.input.context);
        const source = await this.input.store.transport(owner, fence);
        await writeInspectorRequest({ owner, identity: scope.identity, store: this.input.store, spool: this.input.spool,
          gate: this.input.supervisor.io, authority: new PostgresSpoolAllocationAuthority({ store: this.input.store,
            sourceBytes: source.sourceBytes, relativePath: requestRelativePath(scope.identity), owner: () => {
              const state = this.input.supervisor.readiness();
              if (state.state !== "ready" || state.owner.ownerToken !== owner.ownerToken || state.owner.ownerFence !== owner.ownerFence)
                throw new Error("Upload request owner changed"); return state.owner;
            } }) });
      },
      consume: async (output, scope) => { await this.publish(output, scope); return true; },
    }) ?? false;
  }

  private async publish(output: string, job: UploadJobScope): Promise<void> {
    const owner = await job.current();
    const source = await this.input.store.transport(owner, job.identity.fence);
    if (!source.transport.assembled || source.transport.corrupt || typeof source.input.name !== "string") throw new Error("Publication source is incomplete");
    const decoded = decodePublishedInspection(output, { identity: job.identity, bytes: source.sourceBytes,
      sha256: source.transport.assembled.sha256 });
    const prepared = storable(decoded.prepared); const artifacts = decoded.artifacts;
    const metadata = storable({ ...prepared.metadata, details: prepared.details,
      ...(prepared.problem ? { problem: prepared.problem } : {}),
      ...(prepared.text.reason ? { textReason: prepared.text.reason } : {}),
      ...(prepared.coverReason ? { coverReason: prepared.coverReason } : {}) });
    boundedJsonBytes({ metadata, details: prepared.details, extraction: prepared.text, artifacts: prepared.derived }, UPLOAD_LIMITS.reportBytes);
    const publication = stageFile(prepared, metadata, artifacts.get("manifest.json")!);
    const committedMetadata = { ...metadata, medallion: publication.medallion };
    const published = { identity: job.identity, name: source.input.name, prepared, metadata: committedMetadata, publication };
    // Exact authored496 receipt bounds, before any remote object writes. Keep
    // full evidence; never truncate metadata merely to make a receipt fit.
    const inspection = { version: 1, ...published };
    canonicalJson(inspection, 96 * 1024);
    canonicalJson({ ...source.progress, multipartV1: source.progress.multipartV1 ?? {}, inspectionV1: inspection }, 128 * 1024);
    const options: StoreOptions = {
      cacheDir: this.input.spool.root, // ignored by the injected durable state
      scope: { signal: job.signal, current: async () => {
        await job.current(); await this.input.core.assertInspectionCurrent(job.identity, this.input.context); job.signal.throwIfAborted();
      } },
      multipartState: {
        read: async (key) => this.input.store.multipartState(await job.current(), job.identity.fence, key),
        write: async (key, state) => this.input.store.setMultipartState(await job.current(), job.identity.fence, key, state),
        remove: async (key) => this.input.store.setMultipartState(await job.current(), job.identity.fence, key, null),
      },
    };
    const original = { file: path.join(this.input.spool.root, job.identity.fence.operationId, "assembled", "source") };
    const verified = await this.input.spool.verifyRetainedFile(`${job.identity.fence.operationId}/assembled/source`, source.sourceBytes,
      { fence: job.identity.fence, gate: this.input.supervisor.io });
    if (verified.sha256 !== prepared.sha256) throw new Error("Retained publication source checksum differs");
    if (Buffer.byteLength(publication.report) > UPLOAD_LIMITS.reportBytes || Buffer.byteLength(publication.publication) > UPLOAD_LIMITS.reportBytes)
      throw new Error("Stage publication evidence exceeds its bound");
    const put = async (object: Omit<StoreInput, "body">, body: StoreInput["body"]) => storeObject({ ...object, body }, options);
    // Actual 494 publisher and stage order: bronze, silver, validated gold,
    // covers, then the final marker. The inspector never sees storage credentials.
    await put(publication.medallion.bronze, original);
    await put(publication.medallion.silver, { bytes: Buffer.from(publication.report) });
    if (prepared.validation.downloadable) {
      await put({ ...publication.medallion.gold[0], filename: source.input.name }, original);
      for (const object of publication.derived) await put(object, { bytes: object.name === "manifest.json"
        ? Buffer.from(publication.publication) : artifacts.get(object.name)! });
    }
    const problem = await verifyPublication(committedMetadata, options.scope);
    if (problem) throw new Error(problem);
    await options.scope!.current();
    await this.input.core.settleInspection(published, this.input.context);
  }
}
