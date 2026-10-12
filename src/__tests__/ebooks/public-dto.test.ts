import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { publicEbookDTO, publicEbookDetailDTO } from "@/lib/ebooks/public-dto";
import type { EbookDetail } from "@/lib/ebooks/library-queries";
import { publicationFixture } from "./publication-fixture";
const id = "11111111-1111-1111-1111-111111111111";
const fileId = "22222222-2222-2222-2222-222222222222";
const detail: EbookDetail = {
  id, title: "Nadja", subtitle: null, authors: ["André Breton"], language: "fr", matchState: "linked",
  preferredFileId: fileId, coverKey: "gold/private-cover", createdAt: "2026-10-10T08:00:00Z",
  reviewStamp: { updatedAt: "2026-10-10T08:00:00.000000Z", matchFingerprint: "c".repeat(64) },
  matchTier: null, workId: "work", workStatus: "accessioned", exclusionReason: null,
  files: [{ ...publicationFixture(), id: fileId, ebookId: id, createdAt: "2026-10-10T08:00:00Z", coverKey: "gold/private-cover",
    verifiedAt: null, quarantineReason: null, sourceHost: "private-host", sourcePath: "/private/source" }],
  series: null, seriesIndex: null, publisher: "Gallimard", publicationYear: 1964, description: "Surrealist prose", isbns: [],
  identifiers: { asin: ["B00EXAMPLE"], sourcePath: ["/private/source"] }, workSlug: "nadja", workTitle: "Nadja",
  instanceId: "copy", editionId: "edition", editionPublisher: "Gallimard", editionYear: 1964, positions: [],
  history: [{ id: "run-item", runId: "run", createdAt: "2026-10-10", host: "private-host", path: "/private/source", outcome: "stored", reason: null }], historyTotal: 1,
};
describe("public eBook metadata", () => {
  it("allowlists detail and file metadata without private publication or position state", () => {
    const value = publicEbookDetailDTO(detail);
    expect(value.readerPath).toBe(`/reader/${id}?file=${fileId}`);
    expect(value.files[0]).toEqual({ id: fileId, format: "epub", sizeBytes: 200, status: "stored", drm: null, readable: true, downloadable: true });
    expect(value.identifiers).toEqual({ asin: ["B00EXAMPLE"] });
    expect(JSON.stringify(value)).not.toMatch(/gold\/|private|sha256|medallion|locator|history|sourcePath|sourceHost|manifestKey|https:\/\//);
  });
  it("keeps excluded metadata visible when requested but removes all read/download actions", () => {
    const value = publicEbookDTO({ ...detail, matchState: "excluded" });
    expect(value.readable).toBe(false); expect(value.readerPath).toBeNull(); expect(value.formats).toEqual([]);
    expect(value.files[0]).toMatchObject({ readable: false, downloadable: false });
  });
  it("does not publish a linked copy after the eBook has returned to review", () => {
    expect(publicEbookDetailDTO({ ...detail, matchState: "pending", instanceId: null }).linkedCopy).toBeNull();
  });
});
