import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { loadReviewQueue, loadReviewSelectionPage, loadReviewUnlinkTarget, reviewFilterSql, reviewSectionSql } from "@/lib/ebooks/review-queue/queries";
import { parseReviewParams } from "@/lib/ebooks/review-queue/params";
import { REVIEW_SECTIONS } from "@/lib/ebooks/review-queue/types";
import { publicationFixture } from "./publication-fixture";
import { ebookId, reviewRow, stamp, workId, operation } from "./review-ui-fixtures";

const compile = (query: SQL) => new PgDialect().sqlToQuery(query);
function rawRow() {
  const { stamp: _stamp, files: _files, hasCover: _cover, ...row } = reviewRow();
  const file = publicationFixture();
  return { ...row, updatedAt: stamp.updatedAt, matchFingerprint: stamp.matchFingerprint,
    rawFiles: [{ id: "55555555-5555-4555-8555-555555555555", ebook_id: ebookId,
      sha256: file.sha256, s3_key: file.s3Key, size_bytes: file.sizeBytes,
      format: file.format, status: file.status, drm: file.drm as string | null, metadata: file.metadata,
      manifest_key: file.manifestKey, content_type: "application/epub+zip", source_path: "/inbox/Nadja.epub" }] };
}
describe("bounded queue query composition", () => {
  it("uses one counts query and one page of one section, independent of row count (SLN-684)", async () => {
    const counts = Object.fromEntries(REVIEW_SECTIONS.map(({ key }) => [key, key === "not_in_durtal" ? 60 : key === "duplicate" ? 3 : 0]));
    const execute = vi.fn().mockResolvedValueOnce([counts]).mockResolvedValueOnce(Array.from({ length: 20 }, rawRow));
    const queue = await loadReviewQueue({ execute } as unknown as Db, parseReviewParams({}));
    expect(execute).toHaveBeenCalledTimes(2); expect(queue.sections.map((section) => section.key)).toEqual(["duplicate"]);
    expect(queue.page).toBe(1);
    const rowQuery = compile(execute.mock.calls[1][0]);
    expect(rowQuery.sql).toContain("ebook_match_candidates");
    expect(rowQuery.sql).toContain("jsonb_agg"); expect(rowQuery.params).toContain(20);
  });
  it("returns queue languages with the same count query, without filtering them to the selected language", async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ languages: ["en", "fr"], not_in_durtal: 0 }]);
    const queue = await loadReviewQueue({ execute } as unknown as Db, parseReviewParams({ language: "fr" }));
    expect(queue.languages).toEqual(["en", "fr"]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(compile(execute.mock.calls[0][0]).sql).toContain("select distinct e.language");
  });
  it("opens the named section at its page, and the last page for one past the end (SLN-684)", async () => {
    const counts = Object.fromEntries(REVIEW_SECTIONS.map(({ key }) => [key, key === "not_in_durtal" ? 60 : key === "duplicate" ? 3 : 0]));
    const execute = vi.fn().mockResolvedValueOnce([counts]).mockResolvedValueOnce([rawRow()]);
    const queue = await loadReviewQueue({ execute } as unknown as Db, parseReviewParams({ section: "not_in_durtal", page: "9" }));
    expect(queue.sections.map((section) => section.key)).toEqual(["not_in_durtal"]);
    expect(queue.page).toBe(3);
    expect(compile(execute.mock.calls[1][0]).params).toContain(40);
  });
  it("retains exact microseconds and strips private object keys/full digests from client files", async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ not_in_durtal: 1 }]).mockResolvedValueOnce([rawRow()]);
    const queue = await loadReviewQueue({ execute } as unknown as Db, parseReviewParams({}));
    const row = queue.sections[0].rows[0];
    expect(row.stamp).toEqual(stamp); expect(row.files[0].availability).toBe("native");
    expect(row.files[0].checksum).toHaveLength(12);
    expect(JSON.stringify(row)).not.toMatch(/s3_key|manifest_key|medallion|gold\/ebooks/);
  });
  it("does not invent a guard for an invalid stored timestamp or capability for DRM", async () => {
    const raw = rawRow(); raw.updatedAt = "2026-10-10T10:00:00.001Z";
    raw.rawFiles[0].drm = "adobe-adept";
    const execute = vi.fn().mockResolvedValueOnce([{ not_in_durtal: 1 }]).mockResolvedValueOnce([raw]);
    const queue = await loadReviewQueue({ execute } as unknown as Db, parseReviewParams({}));
    expect(queue.sections[0].rows[0].stamp).toBeNull();
    expect(queue.sections[0].rows[0].files[0].availability).toBe("blocked");
  });
  it("shares parameter-bound filters for counts and rows; run membership uses actual identities", () => {
    const query = compile(reviewFilterSql(parseReviewParams({ work: workId, run: operation.runId, format: "epub", hasIsbn: "yes", q: "Nadja" }).filters));
    expect(query.params).toContain(workId); expect(query.params).toContain(operation.runId);
    expect(query.sql).toContain("item.ebook_id=e.id"); expect(query.sql).toContain("f.id=item.file_id");
    expect(query.sql).not.toContain("item.sha256"); expect(query.sql).not.toContain(workId);
  });
  it("keeps automatic and partially held predicates separate, allowing their intended overlap", () => {
    const automatic = compile(reviewSectionSql("automatic")).sql;
    const held = compile(reviewSectionSql("partially_held")).sql;
    expect(automatic).toContain("30 days"); expect(automatic).toContain("transaction_timestamp()");
    expect(automatic).toContain("match_method"); expect(held).toContain("catalogue_status");
    expect(held).not.toContain("match_method");
  });
  it("filters author and series suggestions by real candidate book relationships", () => {
    const query = compile(reviewFilterSql(parseReviewParams({ author: workId, series: operation.runId }).filters));
    expect(query.params).toContain(workId); expect(query.params).toContain(operation.runId);
    expect(query.sql).toContain("wa.author_id"); expect(query.sql).toContain("sw.series_id");
    expect(query.sql).toContain("ebook_match_candidates"); expect(query.sql).toContain("'co_author'");
  });
  it("pages the full filtered section with a bound UUID cursor, 50 descriptors and one sentinel", async () => {
    const raw = Array.from({ length: 51 }, (_, index) => ({ ...rawRow(), id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    const execute = vi.fn().mockResolvedValueOnce([{ count: 6000 }]).mockResolvedValueOnce(raw);
    const result = await loadReviewSelectionPage({ execute } as unknown as Db,
      { section: "not_in_durtal", filters: { run: operation.runId, author: workId }, cursor: ebookId, authorName: "André Breton" });
    expect(execute).toHaveBeenCalledTimes(2); expect(result.rows).toHaveLength(50);
    expect(result.count).toBe(6000); expect(result.nextCursor).toBe(raw[49].id);
    const query = compile(execute.mock.calls[1][0]);
    expect(query.sql).toContain("order by e.id limit 51"); expect(query.sql).toContain("e.id>");
    expect(query.params).toContain(ebookId); expect(query.params).toContain("André Breton");
    expect(query.params).toContain(operation.runId); expect(query.params).toContain(workId);
    expect(JSON.stringify(result)).not.toMatch(/s3_key|manifest_key|gold\/ebooks/);
  });
  it("terminates an exhausted filtered page without inventing a cursor", async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]);
    expect(await loadReviewSelectionPage({ execute } as unknown as Db, { section: "likely", filters: {}, cursor: null })).toEqual({ rows: [], count: 0, nextCursor: null });
  });
  it("projects only real native matching identity for linked rows and rejects a malformed native receipt", async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ id: ebookId, title: "Nadja", updatedAt: stamp.updatedAt,
      matchFingerprint: stamp.matchFingerprint, nativeMatchingOperation: operation, matchMethod: "isbn", workId, workTitle: "Nadja" }]);
    // With the book it is linked to, for "Link it back" (SLN-684)
    expect(await loadReviewUnlinkTarget({ execute } as unknown as Db, ebookId)).toEqual({ id: ebookId, title: "Nadja", stamp,
      matching: { operation, automatic: true }, book: { workId, title: "Nadja" } });
    expect(execute).toHaveBeenCalledOnce(); const query = compile(execute.mock.calls[0][0]);
    expect(query.params).toContain(ebookId); expect(query.sql).toContain("e.link_written->'operationId'");
    expect(query.sql).not.toContain("to_jsonb(e)"); expect(query.sql).toContain('w.id as "workId"');
    execute.mockResolvedValue([{ id: ebookId, title: "Nadja", updatedAt: stamp.updatedAt,
      matchFingerprint: stamp.matchFingerprint, nativeMatchingOperation: operation, matchMethod: "manual", workId: null, workTitle: null }]);
    expect(await loadReviewUnlinkTarget({ execute } as unknown as Db, ebookId)).toMatchObject({ matching: { automatic: false }, book: null });
    execute.mockResolvedValue([{ id: ebookId, title: "Nadja", updatedAt: stamp.updatedAt,
      matchFingerprint: stamp.matchFingerprint, nativeMatchingOperation: { operationId: "made-up" }, matchMethod: "score" }]);
    await expect(loadReviewUnlinkTarget({ execute } as unknown as Db, ebookId)).rejects.toMatchObject({ code: "invalid_receipt" });
  });
  it("projects linked queue identity in the existing bounded row query without native after-state", async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ automatic: 1 }]).mockResolvedValueOnce([
      { ...rawRow(), state: "linked", nativeMatchingOperation: operation, matchMethod: "identifier" },
    ]);
    const queue = await loadReviewQueue({ execute } as unknown as Db, parseReviewParams({}));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(queue.sections[0].rows[0].matching).toEqual({ operation, automatic: true });
    expect(JSON.stringify(queue.sections[0].rows[0])).not.toMatch(/nativeMatchingOperation|matchMethod|link_written|matchingLinkReceipt/);
  });
});
