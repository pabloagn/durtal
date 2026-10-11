import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
vi.mock("@/lib/db", () => ({ db: {} }));
import { getWorkDigitalAvailability, projectWorkDigitalAvailability, workEbookAvailabilityQuery, type WorkEbookAvailabilityRow } from "@/lib/ebooks/work-availability";
import { publicationFixture } from "./publication-fixture";
import type { ContinueAnchor, ContinueFile } from "@/lib/ebooks/continue-target";

const ebookId = "11111111-1111-1111-1111-111111111111";
const fileId = "22222222-2222-2222-2222-222222222222";
const workId = "33333333-3333-3333-3333-333333333333";
const file: ContinueFile = { ...publicationFixture(), id: fileId, ebookId, createdAt: "2026-10-10T08:00:00Z" };
const row: WorkEbookAvailabilityRow = { workId, originalLanguage: "fr", editionId: "edition-fr", editionLanguage: "fr", editionYear: 1964,
  instanceId: "copy", ebookId, title: "Nadja", preferredFileId: fileId, files: [file], positions: [] };
const place: ContinueAnchor = { deviceId: "local", deviceLabel: "Mac", fileId,
  clientUpdatedAt: "2026-10-10T09:00:00Z", chapter: "Chapter 3", locator: { v: 1, fileHash: file.sha256,
    href: "chapter3.xhtml", sectionIndex: 2, progression: 0.4, totalProgression: 0.44,
    text: { before: "before", highlight: "saved quote", after: "after" } } };

describe("batched work digital availability", () => {
  it("makes one query for repeated work IDs and none for an empty shelf", async () => {
    const execute = vi.fn().mockResolvedValue([row]);
    const result = await getWorkDigitalAvailability([workId, workId], { database: { execute }, deviceId: "local" });
    expect(execute).toHaveBeenCalledOnce();
    expect(new PgDialect().sqlToQuery(execute.mock.calls[0][0]).params).toEqual([workId]);
    expect(result.get(workId)?.read?.readerPath).toBe(`/reader/${ebookId}?file=${fileId}`);
    await getWorkDigitalAvailability([], { database: { execute } });
    expect(execute).toHaveBeenCalledOnce();
  });
  it.each(["missing", "quarantined", "replaced"])("keeps %s copy metadata without a Read target or formats", (status) => {
    const result = projectWorkDigitalAvailability([{ ...row, files: [{ ...file, status }] }], "local").get(workId)!;
    expect(result.read).toBeNull();
    expect(result.ebooks[0].formats).toEqual([]);
    expect(result.ebooks[0].downloadFormats).toEqual([]);
    expect(result.ebooks[0].unavailableReason).toContain("Unavailable");
  });
  it("rejects protected or malformed publications while keeping download-only formats distinct", () => {
    for (const source of [{ ...file, drm: "kindle" }, { ...file, metadata: { medallion: {} } }]) {
      expect(projectWorkDigitalAvailability([{ ...row, files: [source] }], null).get(workId)?.read).toBeNull();
    }
    const data = publicationFixture("cbr");
    data.metadata.medallion.validation.nativeReadable = false;
    const result = projectWorkDigitalAvailability([{ ...row, files: [{ ...data, id: fileId, ebookId, createdAt: file.createdAt }] }], null).get(workId)!;
    expect(result.read).toBeNull();
    expect(result.ebooks[0].formats).toEqual([]);
    expect(result.ebooks[0].downloadFormats).toEqual(["cbr"]);
    expect(result.ebooks[0].unavailableReason).toContain("Download available");
  });
  it("preserves a replaced-file quote and clock while selecting eligible replacement bytes", () => {
    const old = { ...file, id: "44444444-4444-4444-4444-444444444444", sha256: "ef".repeat(32), status: "replaced" };
    const anchor = { ...place, fileId: old.id, locator: { ...place.locator, fileHash: old.sha256 } };
    const result = projectWorkDigitalAvailability([{ ...row, files: [old, file], positions: [anchor] }], "local").get(workId)!;
    expect(result.ebooks[0].continue).toMatchObject({ target: { id: fileId }, projection: "pending-reanchor", targetPercent: null,
      localAnchor: { fileId: old.id, clientUpdatedAt: anchor.clientUpdatedAt, locator: { text: { highlight: "saved quote" } } } });
    expect(JSON.stringify(result.read)).not.toMatch(/gold\/|s3Key|sha256|metadata|locator|clientUpdatedAt/);
  });
  it("selects this device's edition before the original language without rewriting the edition", () => {
    const secondId = "55555555-5555-5555-5555-555555555555";
    const result = projectWorkDigitalAvailability([row, { ...row, ebookId: secondId, editionId: "edition-es", editionLanguage: "es",
      files: [{ ...file, ebookId: secondId }], positions: [place] }], "local").get(workId)!;
    expect(result.read?.id).toBe(secondId);
    expect(result.ebooks.map((ebook) => ebook.editionId)).toEqual(["edition-fr", "edition-es"]);
  });
  it("does not collect position history for export or REST metadata", () => {
    const query = new PgDialect().sqlToQuery(workEbookAvailabilityQuery([workId], false));
    expect(query.sql).not.toContain("ebook_positions");
    expect(query.sql).toContain("copy.status <> 'deaccessioned'");
    expect(query.sql).toContain("ebook.match_state = 'linked'");
    expect(query.sql).toContain("w.kind = 'book'");
  });
});
