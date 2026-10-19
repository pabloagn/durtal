import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { coverTooLarge, makeCovers } from "@/lib/ebooks/ingest/cover";
import { withInspectionBudget } from "@/lib/ebooks/ingest/budget";
import { inspectFile } from "@/lib/ebooks/ingest/inspect";
import { prepareFile } from "@/lib/ebooks/ingest/prepare";
import { bytesSource } from "@/lib/ebooks/ingest/source";
import { InspectorAttemptBudget } from "@/lib/ebooks/upload/inspector-resources";

/*
 * SLN-1388: an upload of a real book, whose cover was a 1600 x 2400 JPEG,
 * failed with "Invalid native image bytes": the cover's reservation of 32
 * bytes a pixel overran the attempt's native budget and failed the attempt.
 * The fixtures are made by `node scripts/qa/make-ebook-fixtures.mjs --covers`.
 */

const fixture = (name: string) => new Uint8Array(readFileSync(`src/__tests__/fixtures/ebooks/${name}`));

describe("covers inside the upload check's budget", () => {
  it.each([
    ["cover-jpeg.epub", "jpeg", 1600, 2400],
    ["cover-png.epub", "png", 1600, 2560],
  ])("prepares %s with all three covers in one budgeted attempt, as the upload check does", async (name, format, width, height) => {
    const bytes = fixture(name);
    const inspection = await inspectFile(bytesSource(bytes, name), "epub");
    try {
      expect(await sharp(Buffer.from(await inspection.cover!.load())).metadata()).toMatchObject({ format, width, height });
    } finally {
      await inspection.close?.();
    }
    const budget = new InspectorAttemptBudget();
    const cache = await mkdtemp(path.join(tmpdir(), "durtal-cover-budget-"));
    try {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const prepared = await withInspectionBudget(budget, () => prepareFile(bytesSource(bytes, name), sha256, "epub", cache));
      expect(prepared.coverReason).toBeNull();
      expect(prepared.derived.map((object) => object.name).filter((n) => n.startsWith("cover-")).sort())
        .toEqual(["cover-240.webp", "cover-400.webp", "cover-800.webp"]);
      expect(() => budget.assertHealthy()).not.toThrow();
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  }, 60_000);

  it("leaves out a cover too large for the budget, with its reason, and the book goes on", async () => {
    const budget = new InspectorAttemptBudget();
    const big = new Uint8Array(await sharp({ create: { width: 3000, height: 4500, channels: 3, background: "#6b5b4b" } }).jpeg().toBuffer());
    const result = await withInspectionBudget(budget, () => makeCovers({ kind: "bytes", load: async () => big }));
    expect(result).toEqual({ covers: null, reason: "The cover is too large to make covers from (3000 x 4500)" });
    expect(() => budget.assertHealthy()).not.toThrow();
  });

  it("says which covers fit before reserving anything", () => {
    expect(coverTooLarge(1600, 2400, 2 * 1024 * 1024, 0)).toBeNull();
    expect(coverTooLarge(1600, 2560, 2 * 1024 * 1024, 0)).toBeNull();
    expect(coverTooLarge(2000, 3000, 2 * 1024 * 1024, 0)).toBeNull();
    expect(coverTooLarge(3000, 4500, 1024, 0)).toContain("too large");
    expect(coverTooLarge(16384, 16384, 1024, 0)).toContain("too large");
    // What the attempt already holds counts
    expect(coverTooLarge(1600, 2400, 1024, 100 * 1024 * 1024)).toContain("too large");
    expect(coverTooLarge(0, 480, 1024, 0)).toBe("The cover has no width or height");
  });
});
