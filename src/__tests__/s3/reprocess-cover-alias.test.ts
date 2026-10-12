import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const state = vi.hoisted(() => ({ rows: [] as { id: string; s3Key: string; thumbnailS3Key: string; type: string }[], put: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: async () => state.rows }) }) } }));
vi.mock("@/lib/s3/covers", () => ({ uploadToS3: state.put }));
vi.mock("@/lib/s3/read-object", () => ({ readS3Object: state.read }));
import { POST } from "@/app/api/media/reprocess/route";
import { realCoverBytes } from "./cover-stage-fixture";
const request = () => new Request("http://localhost/api/media/reprocess", { method: "POST", headers: { "x-admin-token": "disposable-token" } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("ADMIN_TOKEN", "disposable-token"); });
afterEach(() => { vi.unstubAllEnvs(); });
describe("authorized reprocess cannot overwrite an edition poster alias", () => {
  it.each(["gold/covers/edition/thumb.webp", "gold/covers/edition/attempt-abc/thumb.webp", "gold/media/edition/edition/cover/attempt-abc/thumb.webp"])("refuses %s before any storage write/read and reports failure", async thumbnailS3Key => {
    const bytes = await realCoverBytes();
    const hash = () => createHash("sha256").update(bytes).digest("hex");
    const beforeHash = hash();
    state.rows = [{ id: "poster", s3Key: "gold/covers/edition/cover.webp", thumbnailS3Key, type: "poster" }];
    const before = JSON.stringify(state.rows);
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ total: 1, success: 0, failed: 1, errors: [expect.stringContaining("Protected edition cover")] });
    expect(state.put).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled();
    expect(JSON.stringify(state.rows)).toBe(before); expect(hash()).toBe(beforeHash);
  });
});
