import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/catalogue/work-store";
import { planIngest } from "@/lib/ebooks/ingest/plan";
import { writeEbookCorpus } from "../../fixtures/ebook-corpus";

/*
 * SLN-494: the plan over the corpus, timed. It records the time and checks
 * that every file got an outcome; it sets no budget, so it never flakes on
 * a slow runner. The budget is checked on the Mac in sub-issue 9.
 */

const emptyCatalogue = { select: () => ({ from: () => Object.assign(Promise.resolve([]), { where: async () => [] }) }) } as unknown as Db;
const dir = mkdtempSync(path.join(tmpdir(), "durtal-corpus-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the corpus", () => {
  it("plans every file, and records how long it took", { timeout: 120_000 }, async () => {
    const root = path.join(dir, "eBooks");
    const written = await writeEbookCorpus(root, { count: 40 });
    const start = performance.now();
    const plan = await planIngest([root], {
      database: emptyCatalogue,
      host: "test",
      cacheDir: path.join(dir, "cache"),
      target: { database: "test", bucket: "durtal-ebooks", prefix: "", preview: false },
    });
    const ms = performance.now() - start;
    console.info(`Planned ${plan.items.length} files in ${Math.round(ms)} ms: ${(ms / plan.items.length).toFixed(1)} ms a file`);

    // The sidecar is read, never planned as a file
    expect(plan.items).toHaveLength(written.length - 1);
    expect(plan.items.every((i) => i.outcome)).toBe(true);
    const outcomes = (outcome: string) => plan.items.filter((i) => i.outcome === outcome).map((i) => path.relative(root, i.path)).sort();
    expect(outcomes("quarantined")).toEqual(["Damaged/Cut Short.epub", "Damaged/No Spine.epub"]);
    expect(outcomes("duplicate_in_run")).toHaveLength(1);
    expect(outcomes("ignored")).toEqual(["Not books/archive.zip", "Not books/letter.docx", "Not books/notes.txt", "Not books/photo.png"]);
    expect(plan.summary.drm).toEqual({ "adobe-adept": 1, kindle: 1, "pdf-password": 1 });
    expect(outcomes("new_format")).toEqual(["Anna Vale/The Letter and the Lamp (1)/The Letter and the Lamp - Anna Vale.pdf"]);
  });
});
