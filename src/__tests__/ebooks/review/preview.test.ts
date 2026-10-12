import { describe, expect, it } from "vitest";
import { ReviewPreviewCache } from "@/lib/ebooks/review/preview";
import type { FrozenReviewPreview } from "@/lib/ebooks/review/preview";
import type { FrozenAccessionReviewPreview } from "@/lib/ebooks/review/preview";
import { decisionFixture } from "./fixtures";
import { unlinkFixture } from "./unlink-fixture";

/** Cache correctness only. Mock plans here are not durable commit evidence. */
describe("private frozen review preview", () => {
  const fixture = (): FrozenReviewPreview => {
    const input = decisionFixture();
    const request = input.requests[0];
    if (request.action !== "keep") throw new Error("The cache fixture requires a supported Keep request.");
    return { request, before: input.beforeReads[0],
      plan: { ...input.binding.coreOperation, kind: "decision", mode: "classification_only",
        decision: { action: "keep" }, ebooks: [{ id: input.beforeReads[0].ebookId, fingerprint: "d".repeat(64) }],
        createdAt: "2026-10-10T10:00:01.000Z", modelFingerprint: "e".repeat(64),
        snapshot: { rows: { works: [], editions: [], authors: [], person_aliases: [], work_authors: [],
          catalogue_identifiers: [], series: [], instances: [], app_settings: [], locations: [],
          ebooks: [], ebook_files: [], ebook_match_candidates: [] },
          catalogueFingerprint: "f".repeat(64), inputFingerprint: "f".repeat(64) } },
    };
  };
  it("binds exact request, channel and target; caller mutation does not change the cached plan", () => {
    const cache = new ReviewPreviewCache(() => 0), envelope = fixture();
    const token = cache.issue(envelope, "api", "test");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const original = cache.require(token, envelope.request, "api", "test").envelope;
    (envelope.before as { rawEbookSnapshotText: string }).rawEbookSnapshotText = "mutated";
    expect(original.before.rawEbookSnapshotText).not.toBe("mutated");
    expect(() => cache.require(token, envelope.request, "ui", "test")).toThrow();
    expect(() => cache.require(token, envelope.request, "api", "other")).toThrow();
    expect(() => cache.require(token, { ...envelope.request, effectHash: "0".repeat(64) }, "api", "test")).toThrow();
  });
  it("expires and evicts without supplying a replacement plan", () => {
    let now = 0;
    const cache = new ReviewPreviewCache(() => now), envelope = fixture();
    const token = cache.issue(envelope, "ui", "test");
    now = 600_001;
    expect(() => cache.require(token, envelope.request, "ui", "test")).toThrow("new review preview");
    const cache2 = new ReviewPreviewCache(() => 0);
    const oldest = cache2.issue(envelope, "api", "test");
    for (let i = 0; i < 128; i++) cache2.issue(envelope, "api", "test");
    expect(() => cache2.require(oldest, envelope.request, "api", "test")).toThrow();
  });
  it("binds the complete ordered batch and separates token kinds inside the same cache budget", () => {
    const cache = new ReviewPreviewCache(() => 0), single = fixture();
    const requests = [{ ...single.request, action: "accession" as const }];
    const batch: FrozenAccessionReviewPreview = { plan: { ...single.plan, kind: "accession_batch", mode: "ingestion",
      authors: [], series: [], entries: [] }, requests, beforeReads: [single.before] };
    const singleToken = cache.issue(single, "api", "test"), batchToken = cache.issueAccession(batch, "api", "test");
    expect(cache.requireAccession(batchToken, requests, "api", "test").envelope.requests).toEqual(requests);
    expect(() => cache.require(batchToken, single.request, "api", "test")).toThrow();
    expect(() => cache.requireAccession(singleToken, requests, "api", "test")).toThrow();
    expect(() => cache.requireAccession(batchToken, [{ ...requests[0], effectHash: "0".repeat(64) }], "api", "test")).toThrow();
    expect(() => cache.requireAccession(batchToken, requests, "ui", "test")).toThrow();
    for (let i = 0; i < 127; i++) cache.issueAccession(batch, "api", "test");
    expect(() => cache.require(singleToken, single.request, "api", "test")).toThrow();
  });
  it("binds unlink mode/policy/request/channel/target and uses the shared eviction and expiry budget", () => {
    let now = 0;
    const cache = new ReviewPreviewCache(() => now), input = unlinkFixture(), single = fixture();
    const token = cache.issueUnlink(input, "api", "test");
    const saved = cache.requireUnlink(token, input.request, "api", "test").envelope;
    input.plan.cleanup.retained = [];
    expect(saved.plan.cleanup.retained).toHaveLength(1);
    expect(() => cache.require(token, single.request, "api", "test")).toThrow();
    expect(() => cache.requireUnlink(token, input.request, "ui", "test")).toThrow();
    expect(() => cache.requireUnlink(token, input.request, "api", "other")).toThrow();
    expect(() => cache.requireUnlink(token, { ...input.request, originalOperation: input.request.operation }, "api", "test")).toThrow();
    for (let i = 0; i < 128; i++) cache.issue(single, "api", "test");
    expect(() => cache.requireUnlink(token, input.request, "api", "test")).toThrow();
    const fresh = cache.issueUnlink(unlinkFixture(), "api", "test"); now = 600_001;
    expect(() => cache.requireUnlink(fresh, input.request, "api", "test")).toThrow();
  });
});
