import { UploadSupervisor } from "./supervisor";

/** Explicitly started by the owned host service, never a Next.js import side effect. */
export class UploadSupervisorRunner {
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private readinessTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatActive = false;
  private stopping: Promise<void> | null = null;

  constructor(private readonly supervisor: UploadSupervisor, private readonly onFailure: (error: unknown) => void) {}

  async start(): Promise<void> {
    if (this.heartbeatTimer || this.readinessTimer) throw new Error("Supervisor runner already started");
    await this.supervisor.start();
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatActive) return;
      this.heartbeatActive = true;
      this.supervisor.heartbeat().catch((error) => this.fail(error)).finally(() => { this.heartbeatActive = false; });
    }, 10_000);
    this.readinessTimer = setInterval(() => {
      if (this.supervisor.readiness().state !== "ready") this.fail(new Error("Supervisor readiness lost"));
    }, 1000);
  }

  async stop(reason = "shutdown"): Promise<void> {
    if (this.stopping) return this.stopping;
    clearInterval(this.heartbeatTimer); clearInterval(this.readinessTimer);
    this.heartbeatTimer = undefined; this.readinessTimer = undefined;
    this.stopping = this.supervisor.stop(reason);
    // A failed stop keeps ownership/resources held. A new runner needs recovery.
    return this.stopping;
  }

  private fail(error: unknown): void {
    this.onFailure(error);
    void this.stop("readiness_failure").catch((stopError) => this.onFailure(stopError));
  }
}
