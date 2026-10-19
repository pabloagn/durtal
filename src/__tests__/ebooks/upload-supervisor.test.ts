import { describe, expect, it, vi } from "vitest";
import { UploadSupervisor, type SupervisorOwner, type UploadSupervisorPersistence, type SupervisorInspector, type SupervisorSpool } from "@/lib/ebooks/upload/supervisor";
import type { SupervisorHostLock } from "@/lib/ebooks/upload/host-lock";
import type { InspectorContainerState } from "@/lib/ebooks/upload/container-runtime";
import { supervisorBindingSha256, type InspectorBuildEvidence, type InspectorIdentity, type InspectorRuntimeConfig } from "@/lib/ebooks/upload/runtime-contract";
import { UPLOAD_LIMITS } from "@/lib/ebooks/upload/limits";
import { UploadItemFailed, UploadItemRefusal } from "@/lib/ebooks/upload/job-failure";

function setup(beforeRelease?: () => Promise<void>) {
  let now = 1000;
  const events: string[] = [];
  const config: InspectorRuntimeConfig = { dockerExecutable: "/usr/bin/docker", dockerSocket: "/private/docker.sock", dockerConfigDirectory: "/private/config",
    image: `durtal/inspector@sha256:${"a".repeat(64)}`, spoolRoot: "/private/spool", uid: 1001, gid: 1001 };
  const owner: SupervisorOwner = { volumeId: "11111111-1111-4111-8111-111111111111", bindingSha256: "b".repeat(64),
    ownerToken: "33333333-3333-4333-8333-333333333333", ownerFence: 8, leaseExpiresAt: 61_000 };
  const hostId = "66666666-6666-4666-8666-666666666666";
  const ownershipPort = 45_506; // fixture only, never opened by tests
  owner.bindingSha256 = supervisorBindingSha256({ volumeId: owner.volumeId, hostId, ownershipPort, runtime: config });
  const fence = { operationId: "22222222-2222-4222-8222-222222222222", ownerToken: owner.ownerToken, ownerFence: owner.ownerFence, generation: 3 };
  const oldIdentity: InspectorIdentity = { volumeId: owner.volumeId, bindingSha256: owner.bindingSha256,
    fence: { ...fence, ownerToken: "44444444-4444-4444-8444-444444444444", ownerFence: 7, generation: 2 } };
  let containers: InspectorContainerState[] = [{ id: "c".repeat(64), identity: oldIdentity, status: "running", exitCode: 0, oomKilled: false }];
  let held = false;
  const hostLock: SupervisorHostLock = {
    port: ownershipPort,
    acquire: vi.fn(async () => { events.push("host_lock"); held = true; }),
    assertHeld: vi.fn(() => { if (!held) throw new Error("lock lost"); }),
    release: vi.fn(async () => { events.push("host_release"); held = false; }),
  };
  const persistence: UploadSupervisorPersistence = {
    beginRecovery: vi.fn(async ({ ownerToken }) => { events.push("new_fence"); owner.ownerToken = ownerToken; fence.ownerToken = ownerToken;
      return { owner, operations: [{ fence, retained: true }] }; }),
    assertOwner: vi.fn(async () => { events.push("owner_check"); }),
    reconcile: vi.fn(async () => { events.push("reconcile"); }),
    persistCleanupAndReleaseWorker: vi.fn(async () => { events.push("proof_and_worker_release"); }),
    markReady: vi.fn(async () => { events.push("ready"); }),
    markQuiescing: vi.fn(async () => { events.push("fence_effects"); }),
    assertOperation: vi.fn(async () => { events.push("operation_check"); }),
    recordJobFailure: vi.fn(async () => { events.push("failed_without_receipt"); }),
    heartbeat: vi.fn(async () => ({ ...owner, leaseExpiresAt: now + 60_000 })),
  };
  const inspector: SupervisorInspector = {
    preflight: vi.fn(async () => { events.push("controllers"); }),
    inventory: vi.fn(async () => { events.push("container_inventory"); return containers.map((c) => ({ ...c })); }),
    create: vi.fn(async (identity) => { events.push("create"); const state: InspectorContainerState = { id: "d".repeat(64), identity, status: "created", exitCode: 0, oomKilled: false }; containers = [state]; return state; }),
    execute: vi.fn(async () => { events.push("execute"); containers = containers.map((c) => ({ ...c, status: "exited" })); return "bounded-report"; }),
    stop: vi.fn(async (identity) => { events.push("exit_proof"); const state = containers.find((c) => c.identity.fence.ownerFence === identity.fence.ownerFence)!; state.status = "exited"; return { ...state }; }),
    remove: vi.fn(async () => { events.push("remove_container"); containers = []; }),
  };
  const inventory = { files: [], allocatedBytes: 0, availableBytes: 100_000_000_000, allocationUnitBytes: 4096, sha256: "e".repeat(64) };
  const spool: SupervisorSpool = { inventory: vi.fn(async () => { events.push("file_hash_inventory"); return inventory; }),
    removeScratch: vi.fn(async () => { events.push("scratch_cleanup"); }) };
  const build: InspectorBuildEvidence = { image: config.image, sourceRevision: "a".repeat(40), protocol: 1, cgroupLimitsBeforeParsing: true, archiveDirectoryBeforeListing: true,
    actualDecodedBytesBeforeRetention: true, retainedTextBeforeAllocation: true, nativeImageBudgetBeforeDecode: true,
    pdfTextDeadline: true, boundedOutput: true, noCloudOrDatabaseCredentials: true };
  const supervisor = new UploadSupervisor({ volumeId: owner.volumeId, hostId, ownershipPort, bindingSha256: owner.bindingSha256, runtimeConfig: config, build,
    persistence, inspector, spool, hostLock, now: () => now, beforeRelease });
  return { supervisor, owner, fence, events, inspector, persistence, spool, hostLock, build,
    setNow: (value: number) => { now = value; }, setContainers: (value: InspectorContainerState[]) => { containers = value; } };
}

describe("restart-safe owned supervisor", () => {
  it("fences recovery, stops every old tree, hashes files and persists proof before readiness", async () => {
    const s = setup(); await s.supervisor.start();
    expect(s.supervisor.readiness().state).toBe("ready");
    const order = ["host_lock", "controllers", "new_fence", "container_inventory", "exit_proof", "scratch_cleanup", "file_hash_inventory", "reconcile", "proof_and_worker_release", "remove_container", "ready"];
    let previous = -1;
    for (const step of order) { const at = s.events.indexOf(step); expect(at).toBeGreaterThan(previous); previous = at; }
    const proof = vi.mocked(s.persistence.persistCleanupAndReleaseWorker).mock.calls[0][1];
    expect(proof).toMatchObject({ inspector: "exit_confirmed", transportRemoved: false, derivedCacheRemoved: false });
    expect(proof).not.toHaveProperty("proofPersisted");
    expect(s.hostLock.release).not.toHaveBeenCalled();
  });
  it("keeps admission, host ownership and reservations held when exit is uncertain", async () => {
    const s = setup(); vi.mocked(s.inspector.stop).mockImplementation(async () => ({ id: "c".repeat(64),
      identity: { volumeId: s.owner.volumeId, bindingSha256: s.owner.bindingSha256, fence: s.fence }, status: "running", exitCode: 0, oomKilled: false }));
    await expect(s.supervisor.start()).rejects.toThrow("exit");
    expect(s.supervisor.readiness()).toEqual({ state: "blocked" });
    expect(s.spool.removeScratch).not.toHaveBeenCalled();
    expect(s.persistence.persistCleanupAndReleaseWorker).not.toHaveBeenCalled();
    expect(s.hostLock.release).not.toHaveBeenCalled();
  });
  it("passes recorded old-image provenance through recovery stop and removal", async () => {
    const s = setup(); const oldImage = `durtal/inspector@sha256:${"d".repeat(64)}`;
    const old = (await s.inspector.inventory(s.owner.volumeId, s.owner.bindingSha256))[0];
    s.setContainers([{ ...old, image: oldImage }]);
    await s.supervisor.start();
    expect(s.inspector.stop).toHaveBeenCalledWith(old.identity, oldImage, expect.any(AbortSignal));
    expect(s.inspector.remove).toHaveBeenCalledWith(old.identity, oldImage, expect.any(AbortSignal));
    expect(s.supervisor.readiness().state).toBe("ready");
  });
  it("aborts a stalled recovery inventory at its deadline and stops renewal without releasing charges", async () => {
    vi.useFakeTimers();
    try {
      const s = setup(); let begun!: () => void;
      const inventoryStarted = new Promise<void>((resolve) => { begun = resolve; });
      vi.mocked(s.inspector.inventory).mockImplementation(async (_volume, _binding, signal) => {
        expect(signal).toBeDefined(); begun();
        return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }));
      });
      const pending = s.supervisor.start();
      const rejected = expect(pending).rejects.toThrow("recovery deadline");
      await inventoryStarted;
      await vi.advanceTimersByTimeAsync(UPLOAD_LIMITS.jobMs); await rejected;
      const renewals = vi.mocked(s.persistence.heartbeat).mock.calls.length;
      expect(renewals).toBeGreaterThan(0);
      expect(vi.mocked(s.persistence.heartbeat).mock.calls.every((call) => call[3]?.aborted)).toBe(true);
      await vi.advanceTimersByTimeAsync(UPLOAD_LIMITS.workerLeaseMs * 2);
      expect(s.persistence.heartbeat).toHaveBeenCalledTimes(renewals);
      expect(s.supervisor.readiness()).toEqual({ state: "blocked" });
      expect(s.supervisor.io.snapshot().accepting).toBe(false);
      expect(s.persistence.persistCleanupAndReleaseWorker).not.toHaveBeenCalled();
      expect(s.persistence.markReady).not.toHaveBeenCalled(); expect(s.hostLock.release).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("keeps readiness closed if reconciliation or proof persistence fails", async () => {
    for (const method of ["reconcile", "persistCleanupAndReleaseWorker"] as const) {
      const s = setup(); vi.mocked(s.persistence[method]).mockRejectedValue(new Error("database response lost"));
      await expect(s.supervisor.start()).rejects.toThrow("response lost");
      expect(s.persistence.markReady).not.toHaveBeenCalled(); expect(s.hostLock.release).not.toHaveBeenCalled();
    }
  });
  it("does not kill an unknown operation discovered in the owned volume", async () => {
    const s = setup(); s.setContainers([{ id: "c".repeat(64), identity: { volumeId: s.owner.volumeId, bindingSha256: s.owner.bindingSha256,
      fence: { ...s.fence, operationId: "55555555-5555-4555-8555-555555555555" } }, status: "running", exitCode: 0, oomKilled: false }]);
    await expect(s.supervisor.start()).rejects.toThrow("Unknown"); expect(s.inspector.stop).not.toHaveBeenCalled();
  });
  it("never claims readiness for a legacy unbounded parser", async () => {
    const s = setup(); s.build.actualDecodedBytesBeforeRetention = false;
    await expect(s.supervisor.start()).rejects.toThrow("not verified"); expect(s.hostLock.acquire).not.toHaveBeenCalled();
  });
  it("expires local readiness and closes writes even before the durable lease expires", async () => {
    const s = setup(); await s.supervisor.start(); s.setNow(21_001);
    expect(s.supervisor.readiness()).toEqual({ state: "quiescing" });
    expect(s.supervisor.io.snapshot().accepting).toBe(false);
    await expect(s.supervisor.inspect(s.fence)).rejects.toThrow("unavailable");
  });
  it("accepts renewed leases only from the same durable owner", async () => {
    const s = setup(); await s.supervisor.start(); s.setNow(11_000); await s.supervisor.heartbeat();
    expect(s.supervisor.readiness().state).toBe("ready");
    vi.mocked(s.persistence.heartbeat).mockResolvedValue({ ...s.owner, ownerFence: 9 });
    await expect(s.supervisor.heartbeat()).rejects.toThrow("ownership"); expect(s.supervisor.io.snapshot().accepting).toBe(false);
  });
  it("can renew the durable lease while readiness remains recovering during a long file scan", async () => {
    const s = setup();
    vi.mocked(s.spool.inventory).mockImplementation(async () => {
      expect(s.supervisor.readiness()).toEqual({ state: "recovering" });
      s.setNow(11_000); await s.supervisor.heartbeat();
      return { files: [], allocatedBytes: 0, availableBytes: 100_000_000_000, allocationUnitBytes: 4096, sha256: "e".repeat(64) };
    });
    await s.supervisor.start(); expect(s.persistence.heartbeat).toHaveBeenCalledTimes(1);
    expect(s.supervisor.readiness().state).toBe("ready");
  });
  it("cleans up an inspector whose create response was lost, without returning a result", async () => {
    const s = setup(); await s.supervisor.start();
    vi.mocked(s.inspector.create).mockImplementation(async (identity) => {
      s.setContainers([{ id: "d".repeat(64), identity, status: "created", exitCode: 0, oomKilled: false }]);
      throw new Error("create response lost");
    });
    const failed = await s.supervisor.inspect(s.fence).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(UploadItemFailed);
    expect((failed as Error).cause).toMatchObject({ message: "create response lost" });
    expect(s.inspector.execute).not.toHaveBeenCalled();
    expect(vi.mocked(s.persistence.persistCleanupAndReleaseWorker).mock.calls).toHaveLength(2);
    // The discovered container's exit and the cleanup were proved: only this item failed (SLN-1388)
    expect(s.persistence.recordJobFailure).toHaveBeenCalledWith(expect.any(Object), s.fence, { reason: "check_failed", what: null });
    expect(s.supervisor.readiness().state).toBe("ready");
  });
  it("returns a bounded result only after current-operation validation and confirmed cleanup", async () => {
    const s = setup(); await s.supervisor.start();
    expect(await s.supervisor.inspect(s.fence)).toBe("bounded-report");
    expect(s.inspector.execute).toHaveBeenCalledTimes(1);
    expect(s.persistence.assertOperation).toHaveBeenCalledWith(expect.objectContaining({ ownerToken: s.owner.ownerToken }), s.fence, expect.any(Number));
    expect(s.supervisor.readiness().state).toBe("ready");
  });
  it("fences effect commits before releasing a clean host mutex on shutdown", async () => {
    const s = setup(); await s.supervisor.start(); await s.supervisor.stop();
    expect(s.events.indexOf("fence_effects")).toBeLessThan(s.events.indexOf("host_release"));
    expect(s.supervisor.readiness()).toEqual({ state: "stopped" }); expect(s.supervisor.io.snapshot().accepting).toBe(false);
  });
  it("writes the fenced request before create and retains the lease through publication and core receipt", async () => {
    const s = setup(); await s.supervisor.start();
    let begin!: () => void; let finish!: () => void;
    const publishing = new Promise<void>((resolve) => { begin = resolve; });
    const receipt = new Promise<void>((resolve) => { finish = resolve; });
    const pending = s.supervisor.runJob(s.fence, {
      prepare: async (scope) => { await scope.current(); s.events.push('durable_request'); },
      consume: async (_output, scope) => {
        expect(s.events).toContain('exit_proof');
        await scope.current(); s.events.push('publication'); begin();
        await receipt; s.events.push('core_receipt');
      },
    });
    await publishing;
    expect(s.events.indexOf('durable_request')).toBeLessThan(s.events.indexOf('create'));
    expect(s.persistence.persistCleanupAndReleaseWorker).toHaveBeenCalledTimes(1); // recovery only
    s.setNow(11_000); await s.supervisor.heartbeat();
    expect(s.persistence.heartbeat).toHaveBeenLastCalledWith(expect.any(Object), s.fence, 11_000, undefined);
    expect(s.supervisor.readiness().state).toBe('ready');
    finish(); await pending;
    expect(s.events.indexOf('core_receipt')).toBeLessThan(s.events.lastIndexOf('proof_and_worker_release'));
    expect(s.persistence.persistCleanupAndReleaseWorker).toHaveBeenCalledTimes(2);
    expect(s.hostLock.release).not.toHaveBeenCalled();
  });
  it('renews the claimed job after an overlapping claim response instead of renewing an idle slot', async () => {
    const s = setup(); await s.supervisor.start();
    let claimStarted!: () => void; let returnClaim!: (value: typeof s.fence) => void;
    let publishStarted!: () => void; let finish!: () => void;
    const claiming = new Promise<void>((resolve) => { claimStarted = resolve; });
    const claim = new Promise<typeof s.fence>((resolve) => { returnClaim = resolve; });
    const publishing = new Promise<void>((resolve) => { publishStarted = resolve; });
    const published = new Promise<void>((resolve) => { finish = resolve; });
    const pending = s.supervisor.runNextJob(async () => { claimStarted(); return claim; }, {
      prepare: async () => {}, consume: async () => { publishStarted(); await published; },
    });
    await claiming; const heartbeat = s.supervisor.heartbeat(); returnClaim(s.fence);
    await publishing; await heartbeat;
    expect(s.persistence.heartbeat).toHaveBeenLastCalledWith(expect.any(Object), s.fence, expect.any(Number), undefined);
    finish(); await pending;
  });
  it('uses the overall job deadline during publication and stops renewal without premature cleanup', async () => {
    vi.useFakeTimers();
    try {
      const s = setup(); await s.supervisor.start(); let begin!: () => void; let finish!: () => void;
      const publishing = new Promise<void>((resolve) => { begin = resolve; });
      const published = new Promise<void>((resolve) => { finish = resolve; });
      const receipt = vi.fn();
      const pending = s.supervisor.runJob(s.fence, { prepare: async () => {}, consume: async (_output, scope) => {
        begin(); await published; scope.signal.throwIfAborted(); receipt();
      } });
      const rejected = expect(pending).rejects.toThrow('job deadline');
      await publishing;
      await vi.advanceTimersByTimeAsync(UPLOAD_LIMITS.inspectionMs + 1);
      expect(s.supervisor.readiness().state).toBe('ready');
      await vi.advanceTimersByTimeAsync(UPLOAD_LIMITS.jobMs - UPLOAD_LIMITS.inspectionMs - 1);
      await expect(s.supervisor.heartbeat()).rejects.toThrow('not ready');
      expect(s.persistence.persistCleanupAndReleaseWorker).toHaveBeenCalledTimes(1); expect(receipt).not.toHaveBeenCalled();
      expect(s.hostLock.release).not.toHaveBeenCalled(); finish(); await rejected;
    } finally { vi.useRealTimers(); }
  });
  it("says why the check failed when the failure itself cannot be recorded", async () => {
    const s = setup(); await s.supervisor.start();
    vi.mocked(s.persistence.recordJobFailure).mockRejectedValueOnce(new Error("could not determine data type of parameter $8"));
    await expect(s.supervisor.runJob(s.fence, { prepare: async () => { throw new Error("request response lost"); }, consume: vi.fn() }))
      .rejects.toThrow("The failed upload check could not be recorded (could not determine data type of parameter $8). The check failed: request response lost");
  });
  it("never creates a process when request publication fails", async () => {
    const s = setup(); await s.supervisor.start(); const consume = vi.fn();
    await expect(s.supervisor.runJob(s.fence, { prepare: async () => { throw new Error('request response lost'); }, consume }))
      .rejects.toMatchObject({ name: 'UploadItemFailed', cause: expect.objectContaining({ message: 'request response lost' }) });
    expect(s.inspector.create).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
    expect(s.hostLock.release).not.toHaveBeenCalled();
    expect(vi.mocked(s.persistence.persistCleanupAndReleaseWorker).mock.calls[1][1]).toMatchObject({ inspector: 'never_started', transportRemoved: false });
    expect(s.persistence.recordJobFailure).toHaveBeenCalledWith(expect.any(Object), s.fence, { reason: 'check_failed', what: null });
    expect(s.events.indexOf('failed_without_receipt')).toBeLessThan(s.events.lastIndexOf('proof_and_worker_release'));
  });
  it("keeps ownership on shutdown while host publication remains uncertain", async () => {
    vi.useFakeTimers();
    try {
      const s = setup(); await s.supervisor.start(); let begin!: () => void; let finish!: () => void;
      const publishing = new Promise<void>((resolve) => { begin = resolve; });
      const unsettled = new Promise<void>((resolve) => { finish = resolve; });
      const pending = s.supervisor.runJob(s.fence, { prepare: async () => {}, consume: async () => { begin(); await unsettled; } });
      await publishing;
      const stopping = s.supervisor.stop(); const rejected = expect(stopping).rejects.toThrow('settlement deadline');
      await vi.advanceTimersByTimeAsync(UPLOAD_LIMITS.cleanupMs); await rejected;
      expect(s.hostLock.release).not.toHaveBeenCalled();
      expect(s.persistence.persistCleanupAndReleaseWorker).toHaveBeenCalledTimes(1);
      expect(s.supervisor.readiness().state).toBe('blocked');
      finish(); await pending; // settle the fixture without pretending it exited earlier
    } finally { vi.useRealTimers(); }
  });
  // SLN-1388: one refused or failed file used to quiesce the whole service
  describe("a failure of one job", () => {
    it("fails only that item, with the worker's reason, and keeps the service ready for the next", async () => {
      const s = setup(); await s.supervisor.start();
      const refused = s.supervisor.runJob(s.fence, { prepare: async () => {}, consume: async () => { throw new UploadItemRefusal("PNG image"); } });
      await expect(refused).rejects.toBeInstanceOf(UploadItemFailed);
      expect(s.persistence.recordJobFailure).toHaveBeenCalledWith(expect.any(Object), s.fence, { reason: "not_an_ebook", what: "PNG image" });
      // Exit proved, scratch removed and the proof persisted before the slot reopens
      expect(s.events.lastIndexOf("failed_without_receipt")).toBeLessThan(s.events.lastIndexOf("proof_and_worker_release"));
      expect(s.events.lastIndexOf("exit_proof")).toBeLessThan(s.events.lastIndexOf("proof_and_worker_release"));
      expect(s.supervisor.readiness().state).toBe("ready");
      expect(s.supervisor.io.snapshot().accepting).toBe(true);
      expect(s.persistence.markQuiescing).not.toHaveBeenCalled();
      const next = { ...s.fence, generation: 4 };
      expect(await s.supervisor.runJob(next, { prepare: async () => {}, consume: async (output) => output })).toBe("bounded-report");
      expect(s.supervisor.readiness().state).toBe("ready");
    });
    it("fails only that item when the inspector exits non-zero", async () => {
      const s = setup(); await s.supervisor.start();
      vi.mocked(s.inspector.execute).mockImplementation(async (identity) => {
        s.setContainers([{ id: "d".repeat(64), identity, status: "exited", exitCode: 1, oomKilled: false }]);
        throw new Error("Inspector did not complete successfully");
      });
      await expect(s.supervisor.inspect(s.fence)).rejects.toMatchObject({ name: "UploadItemFailed",
        failure: { reason: "check_failed", what: null } });
      expect(s.supervisor.readiness().state).toBe("ready");
    });
    it("fails only that item when it is canceled while its inspector runs", async () => {
      const s = setup(); await s.supervisor.start();
      vi.mocked(s.inspector.execute).mockImplementation(async (_identity, signal) => {
        s.supervisor.cancelJob(s.fence.operationId); signal.throwIfAborted(); return "never";
      });
      await expect(s.supervisor.inspect(s.fence)).rejects.toBeInstanceOf(UploadItemFailed);
      expect(s.supervisor.readiness().state).toBe("ready");
    });
    it("still blocks the service when the inspector's exit can't be proved", async () => {
      const s = setup(); await s.supervisor.start();
      vi.mocked(s.inspector.execute).mockRejectedValue(new Error("Inspector did not complete successfully"));
      vi.mocked(s.inspector.stop).mockImplementation(async (identity) => ({ id: "d".repeat(64), identity, status: "running", exitCode: 0, oomKilled: false }));
      await expect(s.supervisor.inspect(s.fence)).rejects.toThrow("did not prove owned process-tree exit");
      expect(s.supervisor.readiness().state).toBe("blocked");
      expect(s.supervisor.io.snapshot().accepting).toBe(false);
    });
    it("still quiesces the service when its lease is lost during the job", async () => {
      const s = setup(); await s.supervisor.start();
      vi.mocked(s.inspector.execute).mockImplementation(async (_identity, signal) => {
        s.setNow(UPLOAD_LIMITS.workerLeaseMs); s.supervisor.readiness(); signal.throwIfAborted(); return "never";
      });
      await expect(s.supervisor.inspect(s.fence)).rejects.not.toBeInstanceOf(UploadItemFailed);
      expect(s.supervisor.readiness().state).not.toBe("ready");
    });
  });
  it("drains the owned app bridge before releasing the physical host lock", async () => {
    const events: string[] = []; const s = setup(async () => { events.push('bridge_drained'); });
    await s.supervisor.start();
    vi.mocked(s.hostLock.release).mockImplementation(async () => { events.push('host_released'); });
    await s.supervisor.stop(); expect(events).toEqual(['bridge_drained', 'host_released']);
  });
});
