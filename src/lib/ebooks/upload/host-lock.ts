import { createServer, type Server } from "node:net";
import { checkedInteger } from "./limits";

export interface SupervisorHostLock {
  readonly port: number;
  acquire(): Promise<void>;
  assertHeld(): void;
  release(): Promise<void>;
}

/**
 * A fixed, operator-reserved loopback port is a crash-released host mutex on
 * both macOS and Linux. The port is part of the durable volume binding; it
 * must not change on restart. There is no stale filesystem lock to unlink.
 * This listener is not an app API and accepts no commands or bytes.
 */
export class OwnedSupervisorHostLock implements SupervisorHostLock {
  private server: Server | null = null;
  private acquiring = false;
  constructor(readonly port: number) { checkedInteger(port, "supervisor ownership port", 1024, 65535); }

  async acquire(): Promise<void> {
    if (this.server || this.acquiring) throw new Error("Supervisor host lock already acquired");
    this.acquiring = true;
    const server = createServer((socket) => socket.destroy());
    server.maxConnections = 1;
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => reject(error);
        server.once("error", failed);
        server.listen({ host: "127.0.0.1", port: this.port, exclusive: true }, () => {
          server.removeListener("error", failed);
          resolve();
        });
      });
      server.on("error", () => { this.server = null; server.close(); });
      this.server = server;
    } finally { this.acquiring = false; }
  }

  assertHeld(): void {
    if (!this.server?.listening) throw new Error("Supervisor exclusive host ownership is unproved");
  }

  async release(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    this.server = null;
  }
}
