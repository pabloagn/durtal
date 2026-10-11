import { DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { execute } }));
vi.mock("@/lib/s3/client", async () => ({ S3_BUCKET: "local-test", s3: { send: (await import("./cover-stage-fixture")).catalogueSend } }));
import { deleteUnusedObjects } from "@/lib/s3/cleanup";
import { coverBucket, resetCoverBucket } from "./cover-stage-fixture";
beforeEach(() => { resetCoverBucket(); execute.mockReset(); execute.mockResolvedValue({ rows: [] }); });
describe("cover/non-gold boundary after final prefix expansion", () => {
  it("retains explicit legacy and staged covers plus prefix-found bronze/silver; deletes only eligible non-cover gold", async () => {
    const keys = ["gold/covers/edition/cover.webp", "gold/covers/edition/attempt-a/thumb.webp", "bronze/covers/edition/original.png", "silver/covers/edition/validated.png", "gold/media/work/a/image.webp"];
    keys.forEach(key => coverBucket.objects.set(key, Buffer.from(key)));
    expect(await deleteUnusedObjects({ keys: [keys[0]], prefixes: ["gold/covers/edition/", "bronze/covers/edition/", "silver/covers/edition/", "gold/media/work/a/"] }, "test helper injected namespace")).toBe(true);
    expect([...coverBucket.objects.keys()]).toEqual(keys.slice(0, 4));
    const deletes = coverBucket.calls.filter((c): c is DeleteObjectsCommand => c instanceof DeleteObjectsCommand);
    expect(deletes.flatMap(c => c.input.Delete?.Objects?.map(o => o.Key))).toEqual([keys[4]]);
    // Only the actually deleted non-cover key may lose its display settings.
    const params = new PgDialect().sqlToQuery(execute.mock.calls.at(-1)![0]).params;
    expect(params).toContain(keys[4]); expect(params).not.toContain(keys[0]);
  });
  it("keeps legitimate referenced cover aliases without calling them pending or orphaned", async () => {
    const key = "gold/covers/edition/thumb.webp";
    coverBucket.objects.set(key, Buffer.from("shared"));
    execute.mockResolvedValue({ rows: [{ k: key }] });
    expect(await deleteUnusedObjects({ keys: [key], prefixes: [] }, "alias still owned")).toBe(false);
    expect(coverBucket.objects.has(key)).toBe(true);
    expect(coverBucket.calls.some(c => c instanceof DeleteObjectCommand || c instanceof DeleteObjectsCommand)).toBe(false);
  });
  it("retains covers and adjustments even if reference inspection fails or adoption follows the no-reference read", async () => {
    const key = "gold/covers/edition/attempt-b/cover.webp";
    coverBucket.objects.set(key, Buffer.from("A"));
    execute.mockRejectedValueOnce(new Error("inspection unavailable"));
    expect(await deleteUnusedObjects({ keys: [key], prefixes: [] }, "failed read")).toBe(true);
    execute.mockImplementationOnce(async () => { /* alias adoption after the captured empty result */ return { rows: [] }; });
    expect(await deleteUnusedObjects({ keys: [key], prefixes: [] }, "concurrent adoption")).toBe(true);
    expect(coverBucket.objects.get(key)).toEqual(Buffer.from("A"));
    expect(execute.mock.calls).toHaveLength(2);
    expect(coverBucket.calls).toEqual([]);
  });
});
