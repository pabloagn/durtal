import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnedUploadServiceConfig } from "@/lib/ebooks/upload/owned-service";
const mocks = vi.hoisted(() => ({ compose: vi.fn(), database: {}, url: "postgresql://fixture@localhost/upload_composition" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: mocks.database }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ DATABASE_URL: mocks.url }) }));
vi.mock("@/lib/ebooks/upload/owned-service", () => ({ OwnedUploadService: { compose: mocks.compose } }));
import { composeActualUploadService } from "@/lib/ebooks/upload-core/owned-service";
import { ActualUploadCoreAdapter } from "@/lib/ebooks/upload-core/service";
import { uploadTargetFingerprint } from "@/lib/ebooks/upload-core/receipts";

// Only the host composer boundary is mocked; this exercises the actual core
// constructor. This partial host fixture proves no runtime/container readiness.
const config = () => ({ volumeId: "90000000-0000-4000-8000-000000000001",
  bridge: { bindingSha256: "a".repeat(64), targetFingerprint: uploadTargetFingerprint(mocks.url),
    socketPath: "/private/upload.sock", secret: "b".repeat(64) },
  runtime: { spoolRoot: "/private/upload-spool" },
} as OwnedUploadServiceConfig);
describe("actual owned upload composition entry", () => {
  beforeEach(() => vi.clearAllMocks());
  it("provides the actual adapter and leaves startup explicit", async () => {
    const service = { start: vi.fn(), stop: vi.fn() }, failure = vi.fn();
    mocks.compose.mockResolvedValue(service);
    expect(await composeActualUploadService(config(), failure)).toBe(service);
    const [captured, core, onFailure] = mocks.compose.mock.calls[0];
    expect(core).toBeInstanceOf(ActualUploadCoreAdapter);
    expect(core.targetFingerprint).toBe(captured.bridge.targetFingerprint);
    expect(onFailure).toBe(failure); expect(service.start).not.toHaveBeenCalled();
  });
  it("captures host binding and nested paths before a delayed composer settles", async () => {
    let release!: (value: unknown) => void;
    mocks.compose.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const submitted = config(), original = submitted.bridge.bindingSha256;
    const pending = composeActualUploadService(submitted, vi.fn());
    submitted.bridge.bindingSha256 = "c".repeat(64); submitted.runtime.spoolRoot = "/changed";
    const [captured, core] = mocks.compose.mock.calls[0];
    expect(captured.bridge.bindingSha256).toBe(original);
    expect(captured.runtime.spoolRoot).toBe("/private/upload-spool");
    expect(Object.isFrozen(captured.bridge)).toBe(true);
    expect(core).toBeInstanceOf(ActualUploadCoreAdapter); release({}); await pending;
  });
});
