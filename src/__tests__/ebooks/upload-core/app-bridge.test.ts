import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ install: vi.fn(), url: "postgresql://fixture@localhost/upload_composition" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ DATABASE_URL: mock.url }) }));
vi.mock("@/lib/ebooks/upload/broker", () => ({ installUploadBroker: mock.install }));
import { UploadHostClient } from "@/lib/ebooks/upload/host-bridge";
import { installActualUploadAppBridge, installUploadAppBridgeFromFile } from "@/lib/ebooks/upload-core/app-bridge";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { uploadTargetFingerprint } from "@/lib/ebooks/upload-core/receipts";
const config = () => ({ socketPath: "/private/upload.sock", secret: "a".repeat(64), bindingSha256: "b".repeat(64),
  targetFingerprint: uploadTargetFingerprint(mock.url) });
describe("actual authenticated app upload bridge", () => {
  beforeEach(() => vi.clearAllMocks());
  it("installs the actual host client without opening a socket or starting a host", () => {
    installActualUploadAppBridge(config());
    expect(mock.install).toHaveBeenCalledTimes(1);
    expect(mock.install.mock.calls[0][0]).toBeInstanceOf(UploadHostClient);
  });
  it("refuses another database before installing any gateway", () => {
    expect(() => installActualUploadAppBridge({ ...config(), targetFingerprint: "c".repeat(64) })).toThrow("another database");
    expect(mock.install).not.toHaveBeenCalled();
  });
  it("installs from the private bridge.json the upload service's init wrote", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "durtal-bridge-"));
    try {
      const file = path.join(folder, "bridge.json");
      await writeFile(file, JSON.stringify(config()), { mode: 0o600 });
      await installUploadAppBridgeFromFile(file);
      expect(mock.install.mock.calls[0][0]).toBeInstanceOf(UploadHostClient);
      await writeFile(file, JSON.stringify({ ...config(), targetFingerprint: "c".repeat(64) }), { mode: 0o600 });
      await expect(installUploadAppBridgeFromFile(file)).rejects.toThrow("another database");
      expect(mock.install).toHaveBeenCalledTimes(1);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
