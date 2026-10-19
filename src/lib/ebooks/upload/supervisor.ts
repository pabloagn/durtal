import { randomUUID } from "node:crypto";
import { checkedInteger, UPLOAD_LIMITS } from "./limits";
import { sameFence, validateFence, type CleanupEvidence, type OperationFence } from "./lifecycle";
import { UploadIoGate } from "./io-gate";
import { requireInspectorBuild, requireUuid, requireSha256, supervisorBindingSha256, type InspectorBuildEvidence, type InspectorIdentity, type InspectorRuntimeConfig } from "./runtime-contract";
import type { InspectorContainerState } from "./container-runtime";
import type { SpoolInventory } from "./private-spool";
import type { SupervisorHostLock } from "./host-lock";
import { UploadItemFailed, uploadJobFailureOf, type UploadJobFailure } from "./job-failure";

export interface SupervisorOwner {
  volumeId: string;
  bindingSha256: string;
  ownerToken: string;
  ownerFence: number;
  leaseExpiresAt: number;
}

export interface RecoverableUpload {
  fence: OperationFence;
  /** Retained parts/cache stay reserved until the existing operation authorizes removal. */
  retained: boolean;
}

export interface SupervisorRecovery {
  owner: SupervisorOwner;
  operations: readonly RecoverableUpload[];
}

/**
 * Adapter for reviewed 0088 services, not a second writer/journal. Each method
 * must use the owner token/fence and current operation generation in its SQL
 * predicate. Effect receipts/registration belong to the actual 494 services.
 */
export interface UploadSupervisorPersistence {
  /** Atomic recovering state/new owner fence; refuses takeover of a live other host. */
  beginRecovery(input: { volumeId: string; bindingSha256: string; ownerToken: string; now: number }): Promise<SupervisorRecovery>;
  assertOwner(owner: SupervisorOwner, now: number): Promise<void>;
  /** Reconcile actual hashes/bytes, unknown allocations and incomplete receipts. No effects. */
  reconcile(owner: SupervisorOwner, inventory: SpoolInventory): Promise<void>;
  /** Persist proof under CAS before releasing worker; do not release retained reservations. */
  persistCleanupAndReleaseWorker(owner: SupervisorOwner, evidence: Omit<CleanupEvidence, "proofPersisted">, inventorySha256: string): Promise<void>;
  markReady(owner: SupervisorOwner, inventory: SpoolInventory, now: number): Promise<void>;
  markQuiescing(owner: SupervisorOwner, reason: string, now: number): Promise<void>;
  assertOperation(owner: SupervisorOwner, fence: OperationFence, now: number): Promise<void>;
  /** Operational failure only, under the live job fence. Preserve committed
   * inspection receipts/canceled rows and all original byte reservations.
   * The failure's reason is what the item's row says (SLN-1388).
   */
  recordJobFailure(owner: SupervisorOwner, fence: OperationFence, failure: UploadJobFailure): Promise<void>;
  /** Renew owner + active worker lease atomically or reject; never just trust a clock. */
  heartbeat(owner: SupervisorOwner, fence: OperationFence | null, now: number, signal?: AbortSignal): Promise<SupervisorOwner>;
}

export interface SupervisorInspector {
  preflight(): Promise<void>;
  inventory(volumeId: string, bindingSha256: string, signal?: AbortSignal): Promise<InspectorContainerState[]>;
  create(identity: InspectorIdentity): Promise<InspectorContainerState>;
  execute(identity: InspectorIdentity, signal: AbortSignal): Promise<string>;
  stop(identity: InspectorIdentity, cleanupImage?: string, signal?: AbortSignal): Promise<InspectorContainerState>;
  remove(identity: InspectorIdentity, cleanupImage?: string, signal?: AbortSignal): Promise<void>;
}

export interface SupervisorSpool {
  inventory(signal?: AbortSignal): Promise<SpoolInventory>;
  removeScratch(operationId: string, signal?: AbortSignal): Promise<void>;
}

export type SupervisorReadiness =
  | { state: "stopped" | "recovering" | "quiescing" | "blocked" }
  | { state: "ready"; owner: SupervisorOwner; checkedAt: number };

export interface UploadJobScope {
  readonly identity: InspectorIdentity;
  readonly signal: AbortSignal;
  /** Fresh durable owner and worker check, including during host publication. */
  current(): Promise<SupervisorOwner>;
}

/** No module startup, CLI installation, HTTP endpoint, cloud or catalogue writes. */
export class UploadSupervisor {
  private owner: SupervisorOwner | null = null;
  private state: SupervisorReadiness["state"] = "stopped";
  private active: { identity: InspectorIdentity; abort: AbortController; settled: Promise<void>; canceled: boolean } | null = null;
  private lastHeartbeatAt = 0;
  private heartbeatPending = false;
  private stopPending: Promise<void> | null = null;
  private ownershipStep: Promise<void> = Promise.resolve();
  readonly io = new UploadIoGate();

  constructor(private readonly dependencies: {
    volumeId: string; hostId: string; ownershipPort: number; bindingSha256: string; runtimeConfig: InspectorRuntimeConfig; build: InspectorBuildEvidence;
    persistence: UploadSupervisorPersistence; inspector: SupervisorInspector; spool: SupervisorSpool;
    hostLock: SupervisorHostLock; now?: () => number;
    /** Drain the owned bridge/dispatcher before releasing the physical mutex. */
    beforeRelease?: () => Promise<void>;
  }) {
    requireUuid(dependencies.volumeId); requireSha256(dependencies.bindingSha256);
    if (dependencies.hostLock.port !== dependencies.ownershipPort || dependencies.bindingSha256 !== supervisorBindingSha256({
      volumeId: dependencies.volumeId, hostId: dependencies.hostId, ownershipPort: dependencies.ownershipPort, runtime: dependencies.runtimeConfig,
    })) throw new Error("Supervisor host/spool/ownership-port binding differs");
  }

  private now(): number { return checkedInteger((this.dependencies.now ?? Date.now)(), "supervisor clock"); }
  private serializeOwnership<T>(task: () => Promise<T>): Promise<T> {
    const result = this.ownershipStep.then(task);
    this.ownershipStep = result.then(() => {}, () => {}); return result;
  }

  readiness(): SupervisorReadiness {
    if (this.state !== "ready" || !this.owner) return { state: this.state } as SupervisorReadiness;
    const now = this.now();
    try { this.dependencies.hostLock.assertHeld(); } catch { this.io.quiesce(); this.active?.abort.abort(new Error("Host ownership lost")); this.state = "blocked"; return { state: "blocked" }; }
    if (now < this.lastHeartbeatAt || now - this.lastHeartbeatAt > UPLOAD_LIMITS.workerLeaseMs / 3 || now >= this.owner.leaseExpiresAt) {
      this.io.quiesce(); this.state = "quiescing"; this.active?.abort.abort(new Error("Supervisor lease/readiness expired"));
      return { state: "quiescing" };
    }
    return { state: "ready", owner: { ...this.owner }, checkedAt: now };
  }

  async start(): Promise<void> {
    if (this.state !== "stopped") throw new Error("Supervisor startup is already in progress");
    this.state = "recovering";
    this.io.quiesce();
    const recoveryAbort = new AbortController();
    const recoveryDeadline = setTimeout(() => recoveryAbort.abort(new Error("Supervisor recovery deadline expired")), UPLOAD_LIMITS.jobMs);
    let renewalTimer: ReturnType<typeof setInterval> | undefined;
    const stopRenewal = () => clearInterval(renewalTimer);
    recoveryAbort.signal.addEventListener("abort", stopRenewal, { once: true });
    try {
      requireInspectorBuild(this.dependencies.runtimeConfig, this.dependencies.build);
      await this.dependencies.hostLock.acquire();
      this.dependencies.hostLock.assertHeld();
      await this.dependencies.inspector.preflight();
      recoveryAbort.signal.throwIfAborted();
      const ownerToken = randomUUID();
      const recovery = await this.dependencies.persistence.beginRecovery({ volumeId: this.dependencies.volumeId,
        bindingSha256: this.dependencies.bindingSha256, ownerToken, now: this.now() });
      recoveryAbort.signal.throwIfAborted();
      this.validateOwner(recovery.owner);
      if (recovery.owner.ownerToken !== ownerToken) throw new Error("Recovery response changed the requested owner token");
      this.owner = { ...recovery.owner };
      this.lastHeartbeatAt = this.now();
      renewalTimer = setInterval(() => {
        if (!recoveryAbort.signal.aborted && !this.heartbeatPending) void this.heartbeat(recoveryAbort.signal).catch((error) => recoveryAbort.abort(error));
      }, 10_000);
      if (recovery.operations.length > 1024) throw new Error("Supervisor recovery operation limit exceeded");
      const seen = new Set<string>();
      for (const operation of recovery.operations) {
        validateFence(operation.fence);
        if (operation.fence.ownerToken !== this.owner.ownerToken || operation.fence.ownerFence !== this.owner.ownerFence
          || seen.has(operation.fence.operationId)) throw new Error("Recovery operation is not fenced to the new owner");
        seen.add(operation.fence.operationId);
      }
      // Inventory every old generation before trusting persisted worker state.
      const containers = await this.dependencies.inspector.inventory(this.owner.volumeId, this.owner.bindingSha256, recoveryAbort.signal);
      recoveryAbort.signal.throwIfAborted();
      for (const container of containers) {
        recoveryAbort.signal.throwIfAborted();
        if (!seen.has(container.identity.fence.operationId)) throw new Error("Unknown inspector operation; recovery remains blocked");
        await this.confirmStop(container.identity, container.image, recoveryAbort.signal);
      }
      await this.io.drain();
      await this.io.barrier(async () => {
        for (const operation of recovery.operations) await this.boundedCleanup((signal) =>
          this.dependencies.spool.removeScratch(operation.fence.operationId, AbortSignal.any([signal, recoveryAbort.signal])));
        const inventory = await this.boundedCleanup((signal) => this.dependencies.spool.inventory(AbortSignal.any([signal, recoveryAbort.signal])));
        await this.currentOwner();
        recoveryAbort.signal.throwIfAborted();
        await this.dependencies.persistence.reconcile(this.owner!, inventory);
        for (const operation of recovery.operations) {
          recoveryAbort.signal.throwIfAborted();
          const started = containers.some((container) => container.identity.fence.operationId === operation.fence.operationId);
          await this.dependencies.persistence.persistCleanupAndReleaseWorker(this.owner!, this.cleanupEvidence(operation.fence, started, inventory), inventory.sha256);
        }
        for (const container of containers) await this.dependencies.inspector.remove(container.identity, container.image, recoveryAbort.signal);
        if ((await this.dependencies.inspector.inventory(this.owner!.volumeId, this.owner!.bindingSha256, recoveryAbort.signal)).length)
          throw new Error("Inspector inventory changed during recovery");
        recoveryAbort.signal.throwIfAborted();
        await this.currentOwner();
        recoveryAbort.signal.throwIfAborted();
        await this.dependencies.persistence.markReady(this.owner!, inventory, this.now());
        recoveryAbort.signal.throwIfAborted();
      });
      // MarkReady/currentOwner checked the durable lease. Preserve its actual freshness.
      this.io.open(this.controlFence());
      this.state = "ready";
    } catch (error) {
      this.io.quiesce(error);
      this.state = "blocked";
      // Keep the host mutex if any tree/cleanup status is uncertain. No unsafe takeover.
      throw error;
    } finally {
      clearInterval(renewalTimer); clearTimeout(recoveryDeadline);
      recoveryAbort.signal.removeEventListener("abort", stopRenewal);
    }
  }

  /** Called by the owned runner at least every 10 seconds, including while inspecting. */
  async heartbeat(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.heartbeatPending) throw new Error("Supervisor heartbeat overlaps");
    this.heartbeatPending = true;
    try {
      await this.serializeOwnership(async () => {
        if (!this.owner || (this.state !== "recovering" && this.readiness().state !== "ready")) throw new Error("Supervisor is not ready");
        this.dependencies.hostLock.assertHeld();
        const owner = await this.dependencies.persistence.heartbeat(this.owner, this.active?.identity.fence ?? null, this.now(), signal);
        signal?.throwIfAborted();
        this.validateOwner(owner);
        if (owner.ownerToken !== this.owner.ownerToken || owner.ownerFence !== this.owner.ownerFence) throw new Error("Heartbeat changed ownership");
        this.owner = { ...owner };
        this.lastHeartbeatAt = this.now();
      });
    } catch (error) {
      this.io.quiesce(error); this.active?.abort.abort(error);
      if (this.state !== "blocked") this.state = "quiescing";
      throw error;
    } finally { this.heartbeatPending = false; }
  }

  /** Serialize the permanent-completion claim with heartbeat and synchronously
   * install its active fence before the next renewal can observe an idle host.
   * Only the claim/activation is serialized, never the full publication job.
   */
  async runNextJob<T>(claim: (owner: SupervisorOwner) => Promise<OperationFence | null>, job: {
    prepare(scope: UploadJobScope): Promise<void>;
    consume(output: string, scope: UploadJobScope): Promise<T>;
  }): Promise<T | undefined> {
    const claimed = await this.serializeOwnership(async () => {
      const ready = this.readiness();
      if (ready.state !== "ready" || this.active) throw new Error("Inspector worker slot unavailable");
      const fence = await claim(ready.owner);
      // runJob installs active synchronously before its first await. Wrapping
      // its promise prevents holding the ownership queue for the whole job.
      return { pending: fence ? this.runJob(fence, job) : undefined };
    });
    return claimed.pending;
  }

  /** Compatibility inspection only; the service dispatcher uses runJob below. */
  async inspect(fence: OperationFence): Promise<string> {
    return this.runJob(fence, { prepare: async () => {}, consume: async (output) => output });
  }

  /** Abort a local job after the core has durably fenced its cancel command.
   * Settlement/exit and cleanup still own the slot; this never refunds bytes.
   */
  cancelJob(operationId: string, reason = "Upload canceled"): void {
    requireUuid(operationId);
    if (this.active?.identity.fence.operationId === operationId) { this.active.canceled = true; this.active.abort.abort(new Error(reason)); }
  }

  /** Keep the same worker lease through request creation, inspection, stage-first
   * publication and the actual core receipt. A deadline requests cancellation;
   * unresolved host I/O is never raced into a fictitious completed cleanup.
   */
  async runJob<T>(fence: OperationFence, job: {
    prepare(scope: UploadJobScope): Promise<void>;
    consume(output: string, scope: UploadJobScope): Promise<T>;
  }): Promise<T> {
    if (this.readiness().state !== "ready" || !this.owner || this.active) throw new Error("Inspector worker slot unavailable");
    validateFence(fence);
    if (fence.ownerToken !== this.owner.ownerToken || fence.ownerFence !== this.owner.ownerFence) throw new Error("Inspector job owner is stale");
    const identity: InspectorIdentity = { volumeId: this.owner.volumeId, bindingSha256: this.owner.bindingSha256, fence: { ...fence } };
    const abort = new AbortController();
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    const active = { identity, abort, settled, canceled: false };
    this.active = active;
    const expire = (reason: string) => {
      const error = new Error(reason); this.io.quiesce(error); this.state = "quiescing"; abort.abort(error);
      // The runner observes readiness loss and durably fences effects. Renewal
      // stops immediately even if a host publication/core promise is unresolved.
    };
    const deadline = setTimeout(() => expire("Upload job deadline expired"), UPLOAD_LIMITS.jobMs);
    let inspectionDeadline: ReturnType<typeof setTimeout> | undefined;
    const scope: UploadJobScope = { identity, signal: abort.signal, current: async () => {
      abort.signal.throwIfAborted();
      await this.currentOwner();
      await this.dependencies.persistence.assertOperation(this.owner!, fence, this.now());
      abort.signal.throwIfAborted();
      if (this.readiness().state !== "ready") throw new Error("Supervisor quiesced before job settlement");
      return { ...this.owner! };
    } };
    let created = false;
    try {
      await scope.current();
      await job.prepare(scope); // durable, fenced request exists before mounting
      await scope.current();
      // No source is mounted while an owned write is in flight.
      await this.io.barrier(async () => {
        await scope.current();
        await this.dependencies.inspector.create(identity);
        created = true;
      });
      abort.signal.throwIfAborted();
      inspectionDeadline = setTimeout(() => expire("Inspector wall deadline expired"), UPLOAD_LIMITS.inspectionMs);
      const output = await this.dependencies.inspector.execute(identity, abort.signal);
      clearTimeout(inspectionDeadline);
      await scope.current();
      // Prove process-tree exit before allowing any host publication. Retain
      // the container record and active lease until the core handoff settles.
      await this.confirmStop(identity);
      await scope.current();
      const result = await job.consume(output, scope);
      // consume returns only after the atomic core receipt, never on a queued
      // fire-and-forget effect. Its response may be lost; originals stay held.
      return result;
    } catch (error) {
      // A failure of this job alone (a refusal, a crashed inspector, a failed
      // publication, a cancel) fails only this item when the finally below
      // proves the inspector's exit and cleanup; the service stays ready. Lost
      // ownership, an expired deadline or a stop still quiesce the service (SLN-1388).
      const local = (!abort.signal.aborted || active.canceled) && this.readiness().state === "ready";
      if (!local) { this.io.quiesce(error); this.state = "quiescing"; }
      const failure = uploadJobFailureOf(error);
      // This transport-owned failure CAS cannot overwrite a committed receipt
      // or cancellation. It leaves the lease live until actual cleanup proof,
      // so a later explicit core retry can use the retained original bytes.
      try {
        await this.dependencies.persistence.recordJobFailure(this.owner!, fence, failure);
      } catch (recordError) {
        // The service stops either way; its log keeps why the check failed
        const say = (e: unknown) => (e instanceof Error ? e.message : String(e));
        throw new Error(`The failed upload check could not be recorded (${say(recordError)}). The check failed: ${say(error)}`,
          { cause: recordError });
      }
      throw local ? new UploadItemFailed(failure, { cause: error, canceled: active.canceled }) : error;
    } finally {
      clearTimeout(deadline); clearTimeout(inspectionDeadline);
      try {
        // create's response can be lost: discover by deterministic fenced identity.
        const discovered = await this.dependencies.inspector.inventory(identity.volumeId, identity.bindingSha256);
        const own = discovered.find((container) => sameFence(container.identity.fence, fence));
        if (created && !own) throw new Error("Created inspector disappeared before exit proof");
        if (discovered.some((container) => !sameFence(container.identity.fence, fence)))
          throw new Error("Unexpected concurrent inspector; cleanup remains blocked");
        if (own) await this.confirmStop(identity);
        await this.io.drain();
        await this.io.barrier(async () => {
          const inventory = await this.boundedCleanup(async (signal) => {
            await this.dependencies.spool.removeScratch(fence.operationId, signal);
            return this.dependencies.spool.inventory(signal);
          });
          await this.currentOwner();
          await this.dependencies.persistence.assertOperation(this.owner!, fence, this.now());
          await this.dependencies.persistence.persistCleanupAndReleaseWorker(this.owner!, this.cleanupEvidence(fence, !!own, inventory), inventory.sha256);
          if (own) await this.dependencies.inspector.remove(identity);
        });
      } catch (error) {
        this.io.quiesce(error); this.state = "blocked";
        throw error;
      } finally { this.active = null; settle(); }
    }
  }

  async stop(reason = "shutdown"): Promise<void> {
    if (this.stopPending) return this.stopPending;
    this.stopPending = this.stopOwned(reason);
    try { await this.stopPending; } finally { this.stopPending = null; }
  }

  private async stopOwned(reason: string): Promise<void> {
    if (!this.owner) throw new Error("Supervisor has no recoverable owner");
    this.state = "quiescing";
    this.io.quiesce(new Error(reason));
    this.active?.abort.abort(new Error(reason));
    try {
      // Persistence must fence all effect/part commits before cleanup begins.
      await this.dependencies.persistence.markQuiescing(this.owner, reason.slice(0, 256), this.now());
      await this.withSettlementDeadline(this.ownershipStep);
      const active = this.active;
      if (active) {
        const identity = active.identity;
        const containers = await this.dependencies.inspector.inventory(identity.volumeId, identity.bindingSha256);
        if (this.active === active && containers.some((container) => sameFence(container.identity.fence, identity.fence))) {
          try { await this.confirmStop(identity); }
          catch (error) { if (this.active === active || this.readiness().state === "blocked") throw error; }
        }
        await this.withSettlementDeadline(active.settled);
        if (this.readiness().state === "blocked") throw new Error("Upload job cleanup remains unproved; ownership stays held");
      }
      await this.io.drain();
      if (!this.io.snapshot().pendingIoSettled) throw new Error("Supervisor allocation/recovery I/O remains active");
      const containers = await this.dependencies.inspector.inventory(this.owner.volumeId, this.owner.bindingSha256);
      if (containers.some((container) => container.status === "running")) throw new Error("Owned process tree remains active");
      // Leave exited artifacts/reservations to deterministic startup reconciliation.
      await this.dependencies.beforeRelease?.();
      this.state = "stopped";
      await this.dependencies.hostLock.release();
      this.owner = null;
    } catch (error) { this.state = "blocked"; throw error; }
  }

  private validateOwner(owner: SupervisorOwner): void {
    requireUuid(owner.volumeId); requireUuid(owner.ownerToken); requireSha256(owner.bindingSha256);
    checkedInteger(owner.ownerFence, "supervisor owner fence");
    checkedInteger(owner.leaseExpiresAt, "supervisor lease expiry", this.now() + 1);
    if (owner.volumeId !== this.dependencies.volumeId || owner.bindingSha256 !== this.dependencies.bindingSha256)
      throw new Error("Supervisor durable binding differs");
  }

  private async currentOwner(): Promise<void> {
    if (!this.owner) throw new Error("Supervisor owner is absent");
    this.dependencies.hostLock.assertHeld();
    if (this.now() >= this.owner.leaseExpiresAt) throw new Error("Supervisor owner lease expired");
    await this.dependencies.persistence.assertOwner(this.owner, this.now());
  }

  private controlFence(): OperationFence {
    if (!this.owner) throw new Error("Supervisor owner is absent");
    return { operationId: this.owner.volumeId, ownerToken: this.owner.ownerToken, ownerFence: this.owner.ownerFence, generation: 0 };
  }

  private async confirmStop(identity: InspectorIdentity, cleanupImage?: string, signal?: AbortSignal): Promise<void> {
    const state = await this.dependencies.inspector.stop(identity, cleanupImage, signal);
    if (state.status === "running" || !sameFence(state.identity.fence, identity.fence)
      || (cleanupImage !== undefined && state.image !== cleanupImage)
      || state.identity.volumeId !== identity.volumeId || state.identity.bindingSha256 !== identity.bindingSha256)
      throw new Error("Inspector stop did not prove owned process-tree exit");
  }

  private async withSettlementDeadline(promise: Promise<void>): Promise<void> {
    let timer!: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Inspector I/O settlement deadline expired; resources remain held")), UPLOAD_LIMITS.cleanupMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  private async boundedCleanup<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error("Upload cleanup deadline expired; resources remain held")), UPLOAD_LIMITS.cleanupMs);
    try {
      // Never race an unresolved filesystem promise and pretend its handles closed.
      const result = await task(abort.signal);
      abort.signal.throwIfAborted();
      return result;
    } finally { clearTimeout(timer); }
  }

  private cleanupEvidence(fence: OperationFence, started: boolean, inventory: SpoolInventory): Omit<CleanupEvidence, "proofPersisted"> {
    const io = this.io.snapshot();
    if (io.activeWriters || !io.streamsClosed) throw new Error("Cleanup I/O evidence is incomplete");
    requireSha256(inventory.sha256);
    return { fence: { ...fence }, inspector: started ? "exit_confirmed" : "never_started", activeWriters: 0,
      streamsClosed: true, pendingIoSettled: true, scratchRemoved: true, allocatedFilesVerified: true,
      transportRemoved: false, derivedCacheRemoved: false };
  }
}
