import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";

/** Stored suggestions only. Creating or rescoring proposals belongs to matching. */
export const getEbookSuggestionCount = cache(async (workId: string): Promise<number> => {
  const [row] = resultRows<{ count: number }>(await db.execute(sql`select count(distinct c.ebook_id)::integer as count
    from ebook_match_candidates c join ebooks e on e.id=c.ebook_id
    where c.work_id=${workId}::uuid and e.match_state='pending' and e.instance_id is null`));
  return Number(row?.count ?? 0);
});
export const getAuthorEbookSuggestionCount = cache(async (authorId: string): Promise<number> => {
  const [row] = resultRows<{ count: number }>(await db.execute(sql`select count(distinct c.ebook_id)::integer as count
    from ebook_match_candidates c join ebooks e on e.id=c.ebook_id join works w on w.id=c.work_id
    join work_authors wa on wa.work_id=w.id
    where wa.author_id=${authorId}::uuid and wa.role in ('author','co_author') and w.kind='book'
      and e.match_state='pending' and e.instance_id is null`));
  return Number(row?.count ?? 0);
});
export const getSeriesEbookSuggestionCount = cache(async (seriesId: string): Promise<number> => {
  const [row] = resultRows<{ count: number }>(await db.execute(sql`select count(distinct c.ebook_id)::integer as count
    from ebook_match_candidates c join ebooks e on e.id=c.ebook_id join works w on w.id=c.work_id
    where w.series_id=${seriesId}::uuid and w.kind='book' and e.match_state='pending' and e.instance_id is null`));
  return Number(row?.count ?? 0);
});
