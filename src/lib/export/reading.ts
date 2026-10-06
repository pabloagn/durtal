import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { idArray } from "@/lib/collections/members";
import { DURTAL_READING_COLUMNS } from "@/lib/reading/import/durtal-format";
import { durtalReadingKey } from "@/lib/reading/source-keys";
import { countedPagesSql, readingStateSql } from "@/lib/reading/summary";
import { notesCondition, type NotesFilter } from "@/lib/reading/notes-conditions";
import { stripHtmlToText } from "@/lib/utils/sanitize";
import { appTimeZone } from "@/lib/utils/date";
import type { CommonplaceNote } from "./commonplace";
import type { GoodreadsBook } from "./goodreads";

/*
 * The reading exports' rows (SLN-458): readings, sessions, quotes and notes,
 * and the facts of the Goodreads file. Every numeric column is cast to
 * float8, so a file holds 4, 4.5 and 44.5. Pages come only from
 * countedPagesSql, summed then rounded; the running timer counts nothing and
 * is not exported.
 */

/** Columns after the Durtal reading CSV's: the importer ignores them */
export const READING_READ_ONLY_COLUMNS = [
  "edition_title",
  "edition_language",
  "translators",
  "copy_location",
  "session_count",
  "minutes_read",
  "pages_read",
] as const;

/** The readings file: exactly the Durtal reading CSV, then the read-only columns */
export const READING_EXPORT_COLUMNS = [...DURTAL_READING_COLUMNS, ...READING_READ_ONLY_COLUMNS] as const;

export const SESSION_EXPORT_COLUMNS = [
  "session_id",
  "reading_id",
  "work_title",
  "day",
  "started_at",
  "ended_at",
  "time_zone",
  "duration_seconds",
  "start_page",
  "end_page",
  "start_percent",
  "end_percent",
  "start_minutes",
  "end_minutes",
  "end_chapter",
  "pages_counted",
  "edition_title",
  "format",
  "source",
] as const;

export const NOTE_EXPORT_COLUMNS = [
  "note_id",
  "work_id",
  "title",
  "authors",
  "kind",
  "body",
  "thought",
  "page",
  "chapter",
  "percent",
  "favourite",
  "reading_id",
  "edition_id",
  "edition_title",
  "translators",
  "source",
  "created_at",
] as const;

type Row = Record<string, string | number | null>;

/** A book's author names in credit order, joined with "; " (work_authors aliased by the book column) */
const authorsOf = (workId: SQL) =>
  sql`(select string_agg(a.name, '; ' order by wa.sort_order, a.name) from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = ${workId})`;

/** An edition's translators in credit order, joined with "; " */
const translatorsOf = (editionId: SQL) =>
  sql`(select string_agg(a.name, '; ' order by ec.sort_order, a.name) from edition_contributors ec join authors a on a.id = ec.author_id
    where ec.edition_id = ${editionId} and ec.role = 'translator')`;

/** These readings (ids), or every book's (null) */
export async function readingExportRows(ids: string[] | null): Promise<Row[]> {
  if (ids && !ids.length) return [];
  const only = ids ? sql`and r.id = any(${idArray(ids)})` : sql``;
  const rows = resultRows<Row & { reading_id: string; source_key: string | null }>(
    await db.execute(sql`with cp as ${countedPagesSql()}
      select r.id::text as reading_id, r.work_id::text as work_id, r.edition_id::text as edition_id, r.instance_id::text as instance_id,
        w.title, ${authorsOf(sql`w.id`)} as authors, e.isbn_13 as isbn13,
        r.status, r.format, r.unit, r.total_pages, r.total_minutes, r.start_page,
        r.current_page, r.current_percent::float8 as current_percent, r.current_minutes, r.current_chapter,
        r.started_on::text as started_on, r.started_precision, r.finished_on::text as finished_on, r.finished_precision,
        r.rating::float8 as rating, r.review_html, r.abandon_reason, r.abandon_note, r.source_key,
        e.title as edition_title, e.language as edition_language, ${translatorsOf(sql`r.edition_id`)} as translators,
        (select concat_ws(' · ', l.name, sl.name) from instances i join locations l on l.id = i.location_id
          left join sub_locations sl on sl.id = i.sub_location_id where i.id = r.instance_id) as copy_location,
        (select count(*)::float8 from reading_sessions s where s.reading_id = r.id and not (s.source = 'timer' and s.ended_at is null)) as session_count,
        (select round(coalesce(sum(s.duration_seconds), 0) / 60.0)::float8 from reading_sessions s
          where s.reading_id = r.id and not (s.source = 'timer' and s.ended_at is null)) as minutes_read,
        (select round(coalesce(sum(c.pages), 0))::float8 from cp c where c.reading_id = r.id) as pages_read
      from readings r join works w on w.id = r.work_id left join editions e on e.id = r.edition_id
      where w.kind = 'book' ${only}
      order by search_normalize(w.title), w.id, coalesce(r.started_on, r.finished_on) asc nulls first, r.created_at, r.id`),
  );
  // A reading made in the app has no key: it goes out as durtal:<id>, so every row names its reading twice
  const byId = new Map(rows.map((row) => [row.reading_id, { ...row, source_key: row.source_key ?? durtalReadingKey(row.reading_id) }]));
  // A filtered export keeps the page's order
  return ids ? ids.flatMap((id) => byId.get(id) ?? []) : [...byId.values()];
}

/** The sessions of these readings (ids), or of every reading (null); a running timer is not exported */
export async function sessionExportRows(readingIds: string[] | null): Promise<Row[]> {
  if (readingIds && !readingIds.length) return [];
  const only = readingIds ? sql`and s.reading_id = any(${idArray(readingIds)})` : sql``;
  return resultRows<Row>(
    await db.execute(sql`with cp as ${countedPagesSql()}
      select s.id::text as session_id, s.reading_id::text as reading_id, w.title as work_title, s.read_on::text as day,
        to_json(s.started_at)#>>'{}' as started_at, to_json(s.ended_at)#>>'{}' as ended_at, s.time_zone, s.duration_seconds,
        s.start_page, s.end_page, s.start_percent::float8 as start_percent, s.end_percent::float8 as end_percent,
        s.start_minutes, s.end_minutes, s.end_chapter,
        (select round(coalesce(sum(c.pages), 0))::float8 from cp c where c.session_id = s.id) as pages_counted,
        e.title as edition_title, s.format, s.source
      from reading_sessions s join readings r on r.id = s.reading_id join works w on w.id = r.work_id
        left join editions e on e.id = s.edition_id
      where w.kind = 'book' and not (s.source = 'timer' and s.ended_at is null) ${only}
      order by search_normalize(w.title), w.id, s.read_on, coalesce(s.started_at, s.created_at), s.created_at, s.id`),
  );
}

interface NoteRow {
  note_id: string;
  reading_id: string | null;
  edition_id: string | null;
  edition_title: string | null;
  translators: string | null;
  source: string;
  created_at: string;
  work_id: string;
  title: string;
  authors: string | null;
  kind: "quote" | "note";
  body: string;
  comment_html: string | null;
  page: number | null;
  chapter: string | null;
  percent: number | null;
  is_favourite: boolean;
}

/** Quotes and notes the commonplace book's filters keep, in book and page order */
async function noteRows(filter: NotesFilter): Promise<NoteRow[]> {
  const condition = notesCondition(filter);
  return resultRows<NoteRow>(
    await db.execute(sql`select n.id::text as note_id, n.work_id::text as work_id, w.title, ${authorsOf(sql`w.id`)} as authors,
        n.kind, n.body, n.comment_html, n.page, n.chapter, n.percent::float8 as percent, n.is_favourite,
        n.reading_id::text as reading_id, n.edition_id::text as edition_id, e.title as edition_title,
        ${translatorsOf(sql`n.edition_id`)} as translators, n.source, to_json(n.created_at)#>>'{}' as created_at
      from reading_notes n join works w on w.id = n.work_id left join editions e on e.id = n.edition_id
      where w.kind = 'book' ${condition ? sql`and ${condition}` : sql``}
      order by search_normalize(w.title), w.id, n.page asc nulls last, n.percent asc nulls last, n.created_at, n.id`),
  );
}

/** One row per quote or note; his thought as plain text */
export async function noteExportRows(filter: NotesFilter): Promise<Row[]> {
  return (await noteRows(filter)).map(({ comment_html, is_favourite, ...row }) => ({
    ...row,
    thought: comment_html ? stripHtmlToText(comment_html).trim() : null,
    favourite: is_favourite ? "yes" : "no",
  }));
}

/** The same notes for the Markdown commonplace book */
export async function commonplaceNotes(filter: NotesFilter): Promise<CommonplaceNote[]> {
  return (await noteRows(filter)).map((n) => ({
    workId: n.work_id,
    title: n.title,
    // The first author, as on the page
    author: n.authors?.split("; ")[0] ?? null,
    kind: n.kind,
    body: n.body,
    thought: n.comment_html ? stripHtmlToText(n.comment_html).trim() : null,
    page: n.page,
    chapter: n.chapter,
    percent: n.percent,
    isFavourite: n.is_favourite,
  }));
}

/**
 * The facts of every book the Goodreads file holds: a book with a reading or
 * in Up Next. "The latest reading" is the last in the order of
 * `readingOrdinalSql`: the open one, else the latest by date.
 */
export async function loadGoodreadsBooks(): Promise<GoodreadsBook[]> {
  return resultRows<GoodreadsBook>(
    await db.execute(sql`
      with books as (
        select w.* from works w where w.kind = 'book'
          and (exists (select 1 from readings r where r.work_id = w.id) or exists (select 1 from reading_queue q where q.work_id = w.id))
      ),
      latest as (
        select distinct on (r.work_id) r.work_id, r.edition_id from readings r
        order by r.work_id, (r.status in ('reading','paused')) desc, coalesce(r.started_on, r.finished_on) desc nulls last,
          r.source_key desc nulls first, r.created_at desc, r.id desc
      ),
      last_finished as (
        select distinct on (r.work_id) r.work_id, r.finished_on, r.finished_precision, r.review_html from readings r where r.status = 'finished'
        order by r.work_id, r.finished_on desc nulls last, r.created_at desc, r.id desc
      ),
      last_abandoned as (
        select distinct on (r.work_id) r.work_id, r.finished_on, r.finished_precision from readings r where r.status = 'abandoned'
        order by r.work_id, r.finished_on desc nulls last, r.created_at desc, r.id desc
      )
      select b.title,
        coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'sortName', a.sort_name) order by wa.sort_order, a.name)
          from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = b.id), '[]'::jsonb) as authors,
        b.original_year as "originalYear", b.rating::float8 as rating,
        to_char(b.created_at at time zone ${appTimeZone()}, 'YYYY-MM-DD') as "createdOn",
        ${readingStateSql(sql`b.id`)} as state,
        exists (select 1 from reading_queue q where q.work_id = b.id) as "inUpNext",
        (select count(*)::float8 from readings r where r.work_id = b.id and r.status = 'finished') as "readCount",
        (select count(*)::float8 from readings r where r.work_id = b.id and r.status = 'abandoned') as "abandonedCount",
        lf.finished_on::text as "lastFinishedOn", lf.finished_precision as "lastFinishedPrecision", lf.review_html as "lastReviewHtml",
        la.finished_on::text as "lastAbandonedOn", la.finished_precision as "lastAbandonedPrecision",
        (select jsonb_build_object('isbn10', e.isbn_10, 'isbn13', e.isbn_13, 'publisher', e.publisher, 'binding', e.binding,
            'pageCount', e.page_count, 'publicationYear', e.publication_year)
          from editions e where e.work_id = b.id
          order by (e.id = l.edition_id) desc nulls last, e.created_at, e.id limit 1) as edition,
        jsonb_build_object(
          'latestEdition', (select e.goodreads_id from editions e where e.id = l.edition_id),
          'anyEdition', (select e.goodreads_id from editions e where e.work_id = b.id and e.goodreads_id is not null order by e.created_at, e.id limit 1),
          'identifier', (select ci.external_id from catalogue_identifiers ci where ci.provider = 'goodreads'
            and (ci.work_id = b.id or ci.edition_id in (select e.id from editions e where e.work_id = b.id))
            order by (ci.work_id is not null) desc, ci.created_at, ci.id limit 1),
          'url', b.goodreads_url) as "goodreadsIds",
        (select count(*)::float8 from instances i join editions e on e.id = i.edition_id
          where e.work_id = b.id and i.status <> 'deaccessioned') as "ownedCopies"
      from books b left join latest l on l.work_id = b.id left join last_finished lf on lf.work_id = b.id
        left join last_abandoned la on la.work_id = b.id
      order by search_normalize(b.title), b.id`),
  );
}
