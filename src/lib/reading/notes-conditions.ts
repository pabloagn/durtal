import { sql, type SQL } from "drizzle-orm";
import { textSearchCondition } from "@/lib/actions/utils/text-search";
import { appTimeZone } from "@/lib/utils/date";
import type { NoteKind } from "./constants";

/** The commonplace book's filters, as the page and its export read them */
export interface NotesFilter {
  q?: string;
  workId?: string;
  authorId?: string;
  kind?: NoteKind;
  favourites?: boolean;
  year?: number;
}

/**
 * The notes these filters keep, over `reading_notes` aliased n (SLN-453):
 * one rule for the commonplace book's page (`searchNotes`) and its export
 * (SLN-458), so a filtered export holds what the page shows. Null: every note.
 */
export function notesCondition(filter: NotesFilter): SQL | null {
  const conditions: SQL[] = [];
  const text = filter.q ? textSearchCondition(sql`n.search_text`, filter.q) : undefined;
  if (text) conditions.push(text);
  if (filter.workId) conditions.push(sql`n.work_id = ${filter.workId}::uuid`);
  if (filter.authorId)
    conditions.push(sql`exists (select 1 from work_authors wa where wa.work_id = n.work_id and wa.author_id = ${filter.authorId}::uuid)`);
  if (filter.kind) conditions.push(sql`n.kind = ${filter.kind}`);
  if (filter.favourites) conditions.push(sql`n.is_favourite`);
  if (filter.year) conditions.push(sql`extract(year from n.created_at at time zone ${appTimeZone()}) = ${filter.year}`);
  return conditions.length ? sql.join(conditions, sql` and `) : null;
}
