import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@/lib/catalogue/work-store";
import { copyContext, copyId, editionId } from "./review-existing-copy-fixtures";
import { workId } from "./review-ui-fixtures";
vi.mock("server-only", () => ({}));
import { loadReviewExistingCopyContext } from "@/lib/ebooks/review-queue/copy-context-query";
import { EXISTING_COPY_METADATA_COLUMNS, existingCopyStampForRow } from "@/lib/ebooks/match/existing-copy";
describe("lazy private copy context", () => {
  it("uses one exact raw metadata/version row and exposes only the declared editable projection", async () => {
    const source = copyContext();
    const row = { id: copyId, edition_id: editionId, updated_at: source.stamp.updatedAt, location_id: source.original.locationId,
      sub_location_id: null, format: "ebook", status: "available", file_size_bytes: null,
      ...Object.fromEntries(Object.entries(EXISTING_COPY_METADATA_COLUMNS).map(([key, column]) => [column, source.metadata[key as keyof typeof source.metadata]])),
      private_reference: "private/native/source", acquisition_price: 12.5 };
    const execute = vi.fn().mockResolvedValue([{ row }]);
    const result = await loadReviewExistingCopyContext({ execute } as unknown as Db, { workId, editionId, instanceId: copyId });
    expect(execute).toHaveBeenCalledOnce(); expect(result.stamp).toEqual(existingCopyStampForRow(row));
    expect(result.metadata.acquisitionPrice).toBe("12.5");
    expect(JSON.stringify(result)).not.toContain("private/native/source"); expect(result).not.toHaveProperty("row");
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    for (const id of [workId, editionId, copyId]) expect(query.params).toContain(id);
    expect(query.sql).toContain("YYYY-MM-DD"); expect(query.sql).toContain("not exists");
    expect(query.sql).toContain("w.kind='book'"); expect(query.sql).toContain("l.is_active");
  });
  it("refuses an unavailable eligible copy without any mutation call", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await expect(loadReviewExistingCopyContext({ execute } as unknown as Db, { workId, editionId, instanceId: copyId }))
      .rejects.toMatchObject({ code: "ineligible_state" });
    expect(execute).toHaveBeenCalledOnce();
  });
});
