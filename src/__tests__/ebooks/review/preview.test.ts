import { describe, expect, it } from "vitest";
import { ReviewPreviewCache, type PreviewRowsLoader } from "@/lib/ebooks/review/preview";
import type { FrozenReviewPreview } from "@/lib/ebooks/review/preview";
import type { FrozenAccessionReviewPreview } from "@/lib/ebooks/review/preview";
import { decisionFixture } from "./fixtures";
import { reviewPayloadHash } from "@/lib/ebooks/review/receipts";
import { unlinkFixture } from "./unlink-fixture";

const emptyRows = () => ({ works: [], editions: [], authors: [], person_aliases: [], work_authors: [],
  catalogue_identifiers: [], series: [], instances: [], app_settings: [], locations: [],
  ebooks: [], ebook_files: [], ebook_match_candidates: [] });

/** Cache correctness only. Mock plans here are not durable commit evidence. */
describe("private frozen review preview", () => {
  const load: PreviewRowsLoader = async (sets) => Object.fromEntries(sets.map((set) => [set, emptyRows()]));
  const fixture = (): FrozenReviewPreview => {
    const input = decisionFixture();
    const request = input.requests[0];
    if (request.action !== "keep") throw new Error("The cache fixture requires a supported Keep request.");
    return { request, before: input.beforeReads[0],
      plan: { ...input.binding.coreOperation, kind: "decision", mode: "classification_only",
        decision: { action: "keep" }, ebooks: [{ id: input.beforeReads[0].ebookId, fingerprint: "d".repeat(64) }],
        createdAt: "2026-10-10T10:00:01.000Z", modelFingerprint: "e".repeat(64),
        snapshot: { rows: emptyRows(),
          catalogueFingerprint: "f".repeat(64), inputFingerprint: "f".repeat(64) } },
    };
  };
  it("binds exact request, channel and target; caller mutation does not change the cached plan", async () => {
    const cache = new ReviewPreviewCache(() => 0), envelope = fixture();
    const token = cache.issue(envelope, "api", "test");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const original = (await cache.require(token, envelope.request, "api", "test", load)).envelope;
    (envelope.before as { rawEbookSnapshotText: string }).rawEbookSnapshotText = "mutated";
    expect(original.before.rawEbookSnapshotText).not.toBe("mutated");
    await expect(cache.require(token, envelope.request, "ui", "test", load)).rejects.toThrow();
    await expect(cache.require(token, envelope.request, "api", "other", load)).rejects.toThrow();
    await expect(cache.require(token, { ...envelope.request, effectHash: "0".repeat(64) }, "api", "test", load)).rejects.toThrow();
  });
  it("expires and evicts without supplying a replacement plan", async () => {
    let now = 0;
    const cache = new ReviewPreviewCache(() => now), envelope = fixture();
    const token = cache.issue(envelope, "ui", "test");
    now = 600_001;
    await expect(cache.require(token, envelope.request, "ui", "test", load)).rejects.toThrow("new review preview");
    const cache2 = new ReviewPreviewCache(() => 0);
    const oldest = cache2.issue(envelope, "api", "test");
    for (let i = 0; i < 128; i++) cache2.issue(envelope, "api", "test");
    await expect(cache2.require(oldest, envelope.request, "api", "test", load)).rejects.toThrow();
  });
  it("binds the complete ordered batch and separates token kinds inside the same cache budget", async () => {
    const cache = new ReviewPreviewCache(() => 0), single = fixture();
    const requests = [{ ...single.request, action: "accession" as const }];
    const batch: FrozenAccessionReviewPreview = { plan: { ...single.plan, kind: "accession_batch", mode: "ingestion",
      authors: [], series: [], entries: [] }, requests, beforeReads: [single.before] };
    const singleToken = cache.issue(single, "api", "test"), batchToken = cache.issueAccession(batch, "api", "test");
    expect((await cache.requireAccession(batchToken, requests, "api", "test", load)).envelope.requests).toEqual(requests);
    await expect(cache.require(batchToken, single.request, "api", "test", load)).rejects.toThrow();
    await expect(cache.requireAccession(singleToken, requests, "api", "test", load)).rejects.toThrow();
    await expect(cache.requireAccession(batchToken, [{ ...requests[0], effectHash: "0".repeat(64) }], "api", "test", load)).rejects.toThrow();
    await expect(cache.requireAccession(batchToken, requests, "ui", "test", load)).rejects.toThrow();
    for (let i = 0; i < 127; i++) cache.issueAccession(batch, "api", "test");
    await expect(cache.require(singleToken, single.request, "api", "test", load)).rejects.toThrow();
  });
  it("binds unlink mode/policy/request/channel/target and uses the shared eviction and expiry budget", async () => {
    let now = 0;
    const cache = new ReviewPreviewCache(() => now), input = unlinkFixture(), single = fixture();
    const token = cache.issueUnlink(input, "api", "test");
    const saved = (await cache.requireUnlink(token, input.request, "api", "test", load)).envelope;
    input.plan.cleanup.retained = [];
    expect(saved.plan.cleanup.retained).toHaveLength(1);
    await expect(cache.require(token, single.request, "api", "test", load)).rejects.toThrow();
    await expect(cache.requireUnlink(token, input.request, "ui", "test", load)).rejects.toThrow();
    await expect(cache.requireUnlink(token, input.request, "api", "other", load)).rejects.toThrow();
    await expect(cache.requireUnlink(token, { ...input.request, originalOperation: input.request.operation }, "api", "test", load)).rejects.toThrow();
    for (let i = 0; i < 128; i++) cache.issue(single, "api", "test");
    await expect(cache.requireUnlink(token, input.request, "api", "test", load)).rejects.toThrow();
    const fresh = cache.issueUnlink(unlinkFixture(), "api", "test"); now = 600_001;
    await expect(cache.requireUnlink(fresh, input.request, "api", "test", load)).rejects.toThrow();
  });
  it("keeps a 6,000 eBook library's rows out of the cache and reads them back on confirm", async () => {
    // About 31 MB of rows, as a 6,000 eBook library plans on: two such previews
    // filled the 32 MB cache, so the second evicted the first or was refused.
    const library = () => ({ ...emptyRows(), ebook_files: Array.from({ length: 6000 }, (_, n) =>
      ({ id: `file-${n}`, ebook_id: `ebook-${n}`, metadata: { text: "x".repeat(5000) } })) });
    const big = (): FrozenReviewPreview => {
      const envelope = fixture();
      return { ...envelope, plan: { ...envelope.plan, snapshot: { ...envelope.plan.snapshot, rows: library() } } };
    };
    const cache = new ReviewPreviewCache(() => 0), first = big(), second = big();
    const tokens = [cache.issue(first, "ui", "test"), cache.issue(second, "ui", "test")];
    const reads: string[][] = [];
    const current: PreviewRowsLoader = async (sets) => { reads.push([...sets]); return { snapshot: library() }; };
    for (const token of tokens) {
      const { envelope, hash } = await cache.require(token, first.request, "ui", "test", current);
      expect(envelope.plan.snapshot.rows).toEqual(first.plan.snapshot.rows);
      expect(hash).toBe(reviewPayloadHash(first));
    }
    expect(reads).toEqual([["snapshot"], ["snapshot"]]);
  });
  it("refuses a confirm when the library changed after the preview, and reads nothing it does not need", async () => {
    const cache = new ReviewPreviewCache(() => 0), envelope = fixture();
    const token = cache.issue(envelope, "ui", "test");
    const changed: PreviewRowsLoader = async () => ({ snapshot: { ...emptyRows(), works: [{ id: "added later" }] } });
    await expect(cache.require(token, envelope.request, "ui", "test", changed))
      .rejects.toMatchObject({ code: "stale_review", message: expect.stringContaining("library changed") });
    const missing: PreviewRowsLoader = async () => ({ snapshot: { works: [] } });
    await expect(cache.require(token, envelope.request, "ui", "test", missing)).rejects.toMatchObject({ code: "stale_review" });
    const unlink = unlinkFixture(), unlinkToken = cache.issueUnlink(unlink, "ui", "test");
    const never: PreviewRowsLoader = async () => { throw new Error("An unlink without row sets reads no rows"); };
    expect((await cache.requireUnlink(unlinkToken, unlink.request, "ui", "test", never)).envelope.plan).toEqual(unlink.plan);
  });
  it("says a preview is too large, not expired, if one could still exceed the cache", () => {
    const envelope = fixture();
    const huge = { ...envelope, before: { ...envelope.before, rawEbookSnapshotText: "x".repeat(33 * 1024 * 1024) } };
    expect(() => new ReviewPreviewCache(() => 0).issue(huge, "ui", "test")).toThrow(expect.objectContaining({ code: "preview_too_large" }));
  });
});
