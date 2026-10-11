import type { PreparedReview, ReviewDetail, ReviewOutcome, ReviewQueueRow } from "@/lib/ebooks/review-queue/types";

export const ebookId = "11111111-1111-4111-8111-111111111111";
export const workId = "22222222-2222-4222-8222-222222222222";
export const stamp = { updatedAt: "2026-10-10T10:00:00.000001Z", matchFingerprint: "a".repeat(64) };
export const operation = { version: 1 as const, operationId: "33333333-3333-4333-8333-333333333333",
  runId: "44444444-4444-4444-8444-444444444444", planSha256: "b".repeat(64), targetDatabase: "test:review-ui" };
export function reviewRow(): ReviewQueueRow {
  return { id: ebookId, title: "Nadja", subtitle: null, authors: ["André Breton"],
    language: "fr", series: null, seriesIndex: null, publisher: null, year: 1928,
    isbns: [], identifiers: {}, state: "pending", tier: "not_in_durtal", stamp, hasCover: false,
    files: [{ id: "55555555-5555-4555-8555-555555555555", format: "epub", sizeBytes: 200,
      status: "stored", drm: null, availability: "native", checksum: "abcdef012345", sourcePath: "/inbox/Nadja.epub" }],
    candidates: [], duplicate: null, work: null };
}
export function preparedReview(): PreparedReview {
  return { request: { action: "keep", ebookId, stamp, operation, effectHash: "c".repeat(64) },
    previewToken: "d".repeat(64), preview: { text: "Kept as a standalone eBook.", format: null, fileSizeBytes: null, locationId: null },
    capabilities: { canApply: true, canUndo: true } };
}
export function reviewOutcome(): ReviewOutcome {
  return { ebookId, operation, message: "Kept as a standalone eBook.", keptCopy: false,
    undo: { available: true, originalOperation: operation } };
}
export function reviewDetail(): ReviewDetail {
  return { id: ebookId, title: "Nadja", authors: ["André Breton"], state: "pending", stamp, candidates: [],
    files: [{ id: "55555555-5555-4555-8555-555555555555", format: "epub", sizeBytes: 200, availability: "native" }] };
}
