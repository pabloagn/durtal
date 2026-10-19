import { randomUUID } from "node:crypto";
import { PrivateUploadSpool } from "./private-spool";
import { OwnedSupervisorHostLock } from "./host-lock";
import { OwnedDockerCommands, OwnedInspectorRuntime } from "./container-runtime";
import { PostgresUploadStore, type UploadSqlExecutor } from "./store";
import { UploadSupervisor } from "./supervisor";
import { UploadSupervisorRunner } from "./supervisor-runner";
import { UploadBroker } from "./broker";
import { UploadDispatcher } from "./dispatcher";
import { UploadHostBridge, type UploadBridgeConfig } from "./host-bridge";
import { supervisorBindingSha256, requireSha256, requireUuid, type InspectorBuildEvidence, type InspectorRuntimeConfig } from "./runtime-contract";
import type { UploadJobCoreAdapter } from "./job-contract";
import type { UploadItemFailed } from "./job-failure";

export interface OwnedUploadServiceConfig {
  volumeId: string; hostId: string; ownershipPort: number;
  runtime: InspectorRuntimeConfig;
  build: InspectorBuildEvidence;
  bridge: UploadBridgeConfig;
}

/** Source-only explicit composition. It validates/open-reads the existing private
 * spool when requested, but starts no host listener, container or DB work until
 * start(). Root must supply the actual 496 adapter and reviewed image/config.
 */
export class OwnedUploadService {
  private started = false;
  private stopping: Promise<void> | null = null;
  private constructor(private readonly runner: UploadSupervisorRunner, private readonly dispatcher: UploadDispatcher,
    private readonly bridge: UploadHostBridge) {}

  static async compose(config: OwnedUploadServiceConfig, core: UploadJobCoreAdapter, onFailure: (error: unknown) => void, executor?: UploadSqlExecutor,
    onItemFailure?: (error: UploadItemFailed) => void): Promise<OwnedUploadService> {
    config = Object.freeze({ ...config, runtime: Object.freeze({ ...config.runtime }), build: Object.freeze({ ...config.build }), bridge: Object.freeze({ ...config.bridge }) });
    requireUuid(config.volumeId); requireUuid(config.hostId); requireSha256(config.bridge.targetFingerprint);
    const binding = supervisorBindingSha256({ volumeId: config.volumeId, hostId: config.hostId,
      ownershipPort: config.ownershipPort, runtime: config.runtime });
    if (binding !== config.bridge.bindingSha256) throw new Error("Upload service and app bridge binding differ");
    if (config.runtime.uid !== process.getuid?.() || config.runtime.gid !== process.getgid?.())
      throw new Error("Inspector and host private spool ownership differ");
    if (typeof core.assertInspectionCurrent !== 'function' || typeof core.settleInspection !== 'function'
      || typeof core.bindSupervisor !== 'function' || core.targetFingerprint !== config.bridge.targetFingerprint)
      throw new Error("Upload service requires the actual fenced publication adapter");
    const spool = await PrivateUploadSpool.open(config.runtime.spoolRoot);
    const hostLock = new OwnedSupervisorHostLock(config.ownershipPort);
    const store = new PostgresUploadStore({ hostId: config.hostId, processId: process.pid, processStartedAt: randomUUID(), hostLock, executor });
    const inspector = new OwnedInspectorRuntime(config.runtime, new OwnedDockerCommands(config.runtime));
    const report = (error: unknown) => { try { onFailure(error); } catch { /* Diagnostics cannot prevent owned quiescence. */ } };
    const fail = (error: unknown) => {
      report(error);
      if (service) void service.stop('upload_service_failure').catch(report);
    };
    const supervisor = new UploadSupervisor({ volumeId: config.volumeId, hostId: config.hostId, ownershipPort: config.ownershipPort,
      bindingSha256: binding, runtimeConfig: config.runtime, build: config.build, persistence: store, inspector, spool, hostLock,
      beforeRelease: async () => { await dispatcher.stop(); await bridge.stop(); } });
    core.bindSupervisor(supervisor);
    const broker = new UploadBroker({ supervisor, store, spool, core, targetFingerprint: config.bridge.targetFingerprint, bindingSha256: binding });
    const bridge = new UploadHostBridge(config.bridge, broker, hostLock);
    const dispatcher = new UploadDispatcher({ supervisor, store, spool, core,
      context: { channel: 'ui', targetFingerprint: config.bridge.targetFingerprint, bindingSha256: binding }, onFailure: fail, onItemFailure });
    const runner = new UploadSupervisorRunner(supervisor, fail);
    const service = new OwnedUploadService(runner, dispatcher, bridge); return service;
  }
  async start(): Promise<void> {
    if (this.started || this.stopping) throw new Error("Upload service cannot start again without a fresh recovery composition");
    this.started = true;
    await this.runner.start(); // failed recovery deliberately retains ownership
    try { await this.bridge.start(); this.dispatcher.start(); }
    catch (error) { await this.stop('upload_service_startup_failure'); throw error; }
  }
  async stop(reason = 'shutdown'): Promise<void> {
    if (this.stopping) return this.stopping;
    this.bridge.closeAdmissions(); this.dispatcher.closeAdmissions();
    // Supervisor durably quiesces first, aborts work, proves exit/settlement and
    // invokes beforeRelease to drain bridge/dispatcher. A failed step holds the
    // physical host mutex and all reservations for deterministic recovery.
    this.stopping = this.runner.stop(reason); return this.stopping;
  }
}
