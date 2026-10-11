import { describe, expect, it } from "vitest";
import { prepareEbookReviewSchema, reviewDecisionRequestSchema } from "@/lib/validations/ebook-review";
import { reviewRequestHash } from "@/lib/ebooks/review/receipts";
import { ReviewPreviewCache, type FrozenReviewPreview } from "@/lib/ebooks/review/preview";
import type { SupportedDecision } from "@/lib/ebooks/review/store";
import { decisionFixture } from "./fixtures";

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = { updatedAt: "2026-10-11T10:00:00.123456Z", metadataFingerprint: "a".repeat(64) };
const intent = { action: "link" as const, ebookId: id(1), workId: id(2),
  choice: { kind: "fill_copy" as const, editionId: id(3), instanceId: id(4) },
  existingCopyPatch: { notes: null, isSigned: true }, expectedCopyStamp: stamp };
type LinkRequest = Extract<SupportedDecision, { action: "link" }>;
const request = (): LinkRequest => {
  const seed = decisionFixture().requests[0];
  if (seed.action !== "keep") throw new Error("The link fixture requires the shared Keep decision seed.");
  return { ...intent, stamp: { ...seed.stamp }, operation: { ...seed.operation }, effectHash: seed.effectHash };
};

describe("existing copy edit is part of one link intent", () => {
  it("preserves omitted fields without create defaults and explicit nullable clears", () => {
    const parsed = prepareEbookReviewSchema.parse(intent);
    expect(parsed.action).toBe("link");
    if (parsed.action !== "link") throw new Error("Unexpected action");
    expect(parsed.existingCopyPatch).toEqual({ notes: null, isSigned: true });
    expect(parsed.expectedCopyStamp).toEqual(stamp);
  });
  it("requires both copy stamp and patch on preparation and confirmation", () => {
    for (const field of ["existingCopyPatch", "expectedCopyStamp"] as const) {
      const partial: Record<string, unknown> = { ...intent }; delete partial[field];
      expect(prepareEbookReviewSchema.safeParse(partial).success).toBe(false);
      expect(reviewDecisionRequestSchema.safeParse({ ...request(), [field]: undefined }).success).toBe(false);
    }
  });
  it("rejects digital, identity, lifecycle and destination fields in metadata", () => {
    for (const field of ["editionId", "locationId", "subLocationId", "format", "fileSizeBytes", "status", "updatedAt", "id"])
      expect(prepareEbookReviewSchema.safeParse({ ...intent,
        existingCopyPatch: { ...intent.existingCopyPatch, [field]: id(9) } }).success).toBe(false);
  });
  it("refuses copy edits on new copies, new editions and mixed create drafts", () => {
    for (const choice of [{ kind: "add_copy", editionId: id(3) }, { kind: "new_edition" }])
      expect(prepareEbookReviewSchema.safeParse({ ...intent, choice }).success).toBe(false);
    expect(prepareEbookReviewSchema.safeParse({ ...intent, newCopyDraft: { notes: "New copy" } }).success).toBe(false);
  });
  it("binds every metadata edit and exact microsecond/fingerprint in the permanent request hash", () => {
    const original = request(), hash = reviewRequestHash(original);
    for (const changed of [
      { ...original, existingCopyPatch: { notes: "Changed", isSigned: true } },
      { ...original, existingCopyPatch: { isSigned: true } },
      { ...original, expectedCopyStamp: { ...stamp, updatedAt: "2026-10-11T10:00:00.123457Z" } },
      { ...original, expectedCopyStamp: { ...stamp, metadataFingerprint: "b".repeat(64) } },
    ]) expect(reviewRequestHash(changed)).not.toBe(hash);
  });
  it("refuses a changed copy edit or stamp with the original frozen preview token", () => {
    const input = decisionFixture(), original = request(), cache = new ReviewPreviewCache(() => 0);
    // Cache binding only: a complete typed DTO, never executable database evidence.
    const envelope: FrozenReviewPreview = { request: original,
      before: { ...input.beforeReads[0], ebookId: original.ebookId,
        rawEbookSnapshotText: JSON.stringify({ id: original.ebookId }) },
      plan: { ...original.operation, kind: "link", mode: "ingestion",
        createdAt: input.beforeReads[0].snapshot.updatedAt, modelFingerprint: "c".repeat(64),
        ebook: { id: original.ebookId, title: "Nadja", authors: ["André Breton"], language: "fr",
          isbns: [], identifiers: {}, createdAt: input.beforeReads[0].snapshot.updatedAt,
          updatedAt: original.stamp.updatedAt, instanceId: null, matchState: "pending", matchFingerprint: null,
          files: [{ id: id(5), sha256: "d".repeat(64), format: "epub", sizeBytes: 200,
            status: "stored", drm: null, availability: "native" }] },
        choices: { ebookId: original.ebookId, workId: intent.workId, method: "manual",
          editionId: intent.choice.editionId, instanceId: intent.choice.instanceId,
          existingCopyPatch: original.existingCopyPatch, expectedCopyStamp: original.expectedCopyStamp },
        effect: { workId: intent.workId, rule: "fill_copy", editionId: intent.choice.editionId,
          instanceId: intent.choice.instanceId, movedFromEditionId: null, newEdition: null, newCopy: null,
          filledCopy: { format: "epub", fileSizeBytes: 200 }, missing: [], ambiguities: [], ready: true,
          text: "Edit copy metadata and attach the file" },
        editionId: intent.choice.editionId, instanceId: intent.choice.instanceId,
        instanceHistoryId: null, activityId: null, editionActivityId: null,
        snapshot: { rows: { works: [], editions: [], authors: [], person_aliases: [], work_authors: [],
          catalogue_identifiers: [], series: [], instances: [], app_settings: [], locations: [],
          ebooks: [], ebook_files: [], ebook_match_candidates: [] },
          catalogueFingerprint: "e".repeat(64), inputFingerprint: "f".repeat(64) } },
    };
    const token = cache.issue(envelope, "ui", "test");
    expect(() => cache.require(token, { ...original, existingCopyPatch: { notes: "Replaced" } }, "ui", "test")).toThrow();
    expect(() => cache.require(token, { ...original, expectedCopyStamp: { ...stamp,
      metadataFingerprint: "b".repeat(64) } }, "ui", "test")).toThrow();
    expect(cache.require(token, original, "ui", "test").envelope.request).toEqual(original);
  });
});
