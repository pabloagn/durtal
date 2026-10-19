import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { ANNOTATION_COLORS, type AnnotationColor } from "@/lib/reader/annotations";
import { normalizeSearchText } from "@/lib/utils/search-text";
import { isUuid } from "@/lib/utils/uuid";
import { parsePagination, toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";
import { ebookSummaryColumns, normalizedDates, type LibraryEbook } from "./library-queries";

type Database = { execute(query: SQL): PromiseLike<unknown> };

export const HIGHLIGHT_KINDS = ["highlight", "note", "bookmark"] as const;
export type HighlightKind = (typeof HIGHLIGHT_KINDS)[number];
export const HIGHLIGHT_SORTS = ["newest", "title"] as const;
export type HighlightSort = (typeof HIGHLIGHT_SORTS)[number];
/** Marks shown under each book. A page holds GROUPS_PER_PAGE books, which keeps
 * /ebooks/highlights inside its 300 KB budget (scripts/qa/page-weight.json). */
export const MARKS_PER_GROUP = 5;
export const GROUPS_PER_PAGE = 12;
/** The list shows the first 3 lines of a highlight and a note's start; the reader has the rest. */
export const SHOWN_TEXT_CHARS = 480;
export const SHOWN_NOTE_CHARS = 600;

export interface HighlightParams {
  q: string;
  normalizedSearch: string;
  colors: AnnotationColor[];
  kinds: HighlightKind[];
  ebookId: string | null;
  sort: HighlightSort;
  order: "asc" | "desc";
  page: number;
  perPage: number;
  offset: number;
}
export interface HighlightMark {
  id: string;
  kind: "highlight" | "bookmark";
  style: "highlight" | "underline" | "quote";
  color: AnnotationColor | null;
  text: string | null;
  note: string | null;
  chapter: string | null;
  pageLabel: string | null;
  progression: number;
  anchorState: "exact" | "healed" | "approximate" | "orphaned";
  updatedAt: string;
}
export interface HighlightGroupRow {
  ebook: LibraryEbook;
  total: number;
  marks: HighlightMark[];
}
export interface HighlightSummary {
  books: number;
  marks: number;
}
export interface HighlightBookOption {
  id: string;
  title: string;
  marks: number;
}

/** Comma lists or repeated keys, deduplicated and bounded. */
function list(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))].slice(0, 20);
}

/** /ebooks/highlights URL contract: q, color, kind, ebook, sort, order, page, perPage. */
export function parseHighlightParams(input: ListSearchParams | URLSearchParams): HighlightParams {
  const params = toSearchParams(input);
  // A NUL can't reach Postgres text: the search drops it rather than failing (SLN-933)
  const q = (params.get("q") ?? "").replaceAll("\u0000", "").trim().slice(0, 200);
  const requested = params.get("sort");
  const sort: HighlightSort = HIGHLIGHT_SORTS.some((value) => value === requested) ? (requested as HighlightSort) : "newest";
  const rawOrder = params.get("order");
  const ebook = params.get("ebook");
  const ebookId = ebook && isUuid(ebook) ? ebook.toLowerCase() : null;
  return {
    q,
    normalizedSearch: normalizeSearchText(q),
    colors: list(params, "color").filter((value): value is AnnotationColor => ANNOTATION_COLORS.some((color) => color === value)),
    kinds: list(params, "kind").filter((value): value is HighlightKind => HIGHLIGHT_KINDS.some((kind) => kind === value)),
    ebookId,
    sort,
    order: rawOrder === "asc" || rawOrder === "desc" ? rawOrder : sort === "newest" ? "desc" : "asc",
    // Filtered to one book, the page lists its marks, paged like any list;
    // otherwise it pages books, a fixed number per page
    ...(ebookId
      ? parsePagination(params)
      : parsePagination(params, { defaultPerPage: GROUPS_PER_PAGE, allowedPerPage: [GROUPS_PER_PAGE] })),
  };
}

const KIND_CONDITIONS: Record<HighlightKind, SQL> = {
  highlight: sql`a.kind = 'highlight'`,
  note: sql`(a.kind = 'highlight' and a.note is not null)`,
  bookmark: sql`a.kind = 'bookmark'`,
};

/** Live marks the filters keep. The text search uses ebook_annotations_search_idx (0083). */
export function highlightWhere(params: HighlightParams): SQL {
  const clauses: SQL[] = [sql`a.deleted_at is null`];
  if (params.ebookId) clauses.push(sql`a.ebook_id = ${params.ebookId}::uuid`);
  if (params.colors.length)
    clauses.push(sql`a.color in (${sql.join(params.colors.map((color) => sql`${color}`), sql`, `)})`);
  if (params.kinds.length)
    clauses.push(sql`(${sql.join(params.kinds.map((kind) => KIND_CONDITIONS[kind]), sql` or `)})`);
  // normalizeSearchText leaves no % or _ in a word, so each is a plain substring
  for (const word of params.normalizedSearch.split(" ").filter(Boolean))
    clauses.push(sql`public.search_normalize(coalesce(a.text, '') || ' ' || coalesce(a.note, '')) like ${`%${word}%`}`);
  return sql.join(clauses, sql` and `);
}

/** `source` is the relation carrying `latest`, the book's newest mark. */
function groupOrder(params: HighlightParams, source: SQL): SQL {
  const direction = params.order === "asc" ? sql`asc` : sql`desc`;
  return params.sort === "title"
    ? sql`e.title_sort collate "C" ${direction} nulls last, e.id asc`
    : sql`${source}.latest ${direction}, e.id asc`;
}

/** Cut by characters (code points), so a cut never splits a character. */
const shown = (column: SQL, chars: number) =>
  sql`case when char_length(${column}) > ${chars} then left(${column}, ${chars - 1}) || '…' else ${column} end`;

const markColumns = sql`m.id, m.kind, m.style, m.color, ${shown(sql`m.text`, SHOWN_TEXT_CHARS)} as text,
  ${shown(sql`m.note`, SHOWN_NOTE_CHARS)} as note, m.chapter,
  m.locator->>'pageLabel' as "pageLabel", m.progression, m.anchor_state as "anchorState",
  to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt"`;

/**
 * Each mark's CFI as an integer array, `steps`, as `cfiPlace` in
 * `lib/reader/book-order.ts` reads it: each step's index, then the character
 * offset, from a range's start. Null when it does not read as a CFI.
 */
const cfiSteps = sql`cross join lateral (select regexp_replace(
    substring(btrim(m.locator->>'cfi') from '^epubcfi\\((.*)\\)$'), '\\[(?:\\^.|[^]^])*\\]', '', 'g') as body) cfi_body
  cross join lateral (select regexp_replace(split_part(cfi_body.body, ',', 1) || split_part(cfi_body.body, ',', 2),
    '[~@].*$', '') as path) cfi_path
  cross join lateral (select case when cfi_path.path ~ '^(?:[/!:~@]|\\d|\\.)+$' then
    (select array_agg(step[2]::integer order by n)
      from regexp_matches(substring(cfi_path.path from '^[^:]*(?::\\d+)?'), '([/:])(\\d+)', 'g') with ordinality as found(step, n))
    end as steps) cfi`;

/**
 * A book's marks in reading order, as the reader's panel and the export list
 * them (compareBookPlaces): by section, then by CFI, then by progression
 * (SLN-1000). Needs `cfiSteps` joined.
 */
const bookOrder = sql`(m.locator->>'sectionIndex')::integer, cfi.steps nulls last, m.progression, m.id`;

/** One page of books with marks, newest mark first, each with its first marks in book order.
 * Filtered to one book: that book, with one page of its marks. */
export function highlightGroupsQuery(params: HighlightParams): SQL {
  const perGroup = params.ebookId ? params.perPage : MARKS_PER_GROUP;
  const groupOffset = params.ebookId ? 0 : params.offset;
  const markOffset = params.ebookId ? params.offset : 0;
  return sql`with marks as (
    select a.* from ebook_annotations a where ${highlightWhere(params)}
  ), g as (
    select ebook_id, count(*)::integer as total, max(updated_at) as latest from marks group by ebook_id
  ), page as (
    select g.ebook_id, g.total, g.latest from g join ebooks e on e.id = g.ebook_id
    order by ${groupOrder(params, sql`g`)} limit ${params.ebookId ? 1 : params.perPage} offset ${groupOffset}
  ) select ${ebookSummaryColumns}, page.total,
    coalesce((select json_agg(json_build_object(
      'id', m.id, 'kind', m.kind, 'style', m.style, 'color', m.color, 'text', m.text, 'note', m.note,
      'chapter', m.chapter, 'pageLabel', m."pageLabel", 'progression', m.progression,
      'anchorState', m."anchorState", 'updatedAt', m."updatedAt") order by m.place)
      from (select ${markColumns}, row_number() over (order by ${bookOrder}) as place
        from marks m ${cfiSteps} where m.ebook_id = page.ebook_id
        order by ${bookOrder} limit ${perGroup} offset ${markOffset}) m), '[]'::json) as marks
  from page join ebooks e on e.id = page.ebook_id
  order by ${groupOrder(params, sql`page`)}`;
}

export async function getHighlightGroups(params: HighlightParams, database: Database = db): Promise<HighlightGroupRow[]> {
  const rows = resultRows<LibraryEbook & { total: number; marks: HighlightMark[] }>(
    await database.execute(highlightGroupsQuery(params)),
  );
  return rows.map(({ total, marks, ...ebook }) => ({ ebook: normalizedDates(ebook), total, marks }));
}

export async function getHighlightSummary(params: HighlightParams, database: Database = db): Promise<HighlightSummary> {
  const [row] = resultRows<HighlightSummary>(await database.execute(sql`select
    count(distinct a.ebook_id)::integer as books, count(*)::integer as marks
    from ebook_annotations a where ${highlightWhere(params)}`));
  return row ?? { books: 0, marks: 0 };
}

/** The e-book filter's choices: every book with a live mark, most marked first. */
export async function getHighlightBooks(database: Database = db): Promise<HighlightBookOption[]> {
  return resultRows<HighlightBookOption>(await database.execute(sql`select e.id, e.title, count(*)::integer as marks
    from ebook_annotations a join ebooks e on e.id = a.ebook_id where a.deleted_at is null
    group by e.id, e.title order by marks desc, e.title_sort collate "C", e.id limit 200`));
}

/** The reader opens at the mark, and Back returns to this list. */
export function highlightReaderHref(ebookId: string, markId: string, returnTo: string): string {
  const params = new URLSearchParams({ at: markId, returnTo });
  return `/reader/${ebookId}?${params}`;
}

export interface EbookMarkCounts {
  highlights: number;
  notes: number;
  bookmarks: number;
}

/** One e-book's live marks, counted as the reader's panel tabs count them (SLN-500) */
export async function getEbookMarkCounts(ebookId: string, database: Database = db): Promise<EbookMarkCounts> {
  const [row] = resultRows<EbookMarkCounts>(await database.execute(sql`select
    count(*) filter (where ${KIND_CONDITIONS.highlight})::integer as highlights,
    count(*) filter (where ${KIND_CONDITIONS.note})::integer as notes,
    count(*) filter (where ${KIND_CONDITIONS.bookmark})::integer as bookmarks
    from ebook_annotations a where a.ebook_id = ${ebookId}::uuid and a.deleted_at is null`));
  return row ?? { highlights: 0, notes: 0, bookmarks: 0 };
}

/** Each e-book's live marks and how many devices have a reading place in it, for the book page's copy rows (SLN-683) */
export async function getEbookReach(ebookIds: readonly string[], database: Database = db): Promise<Map<string, EbookMarkCounts & { places: number }>> {
  if (!ebookIds.length) return new Map();
  const rows = resultRows<EbookMarkCounts & { id: string; places: number }>(await database.execute(sql`select e.id,
    m.highlights, m.notes, m.bookmarks,
    (select count(distinct p.device_label) from ebook_positions p where p.ebook_id = e.id)::integer as places
    from ebooks e cross join lateral (select count(*) filter (where ${KIND_CONDITIONS.highlight})::integer as highlights,
      count(*) filter (where ${KIND_CONDITIONS.note})::integer as notes,
      count(*) filter (where ${KIND_CONDITIONS.bookmark})::integer as bookmarks
      from ebook_annotations a where a.ebook_id = e.id and a.deleted_at is null) m
    where e.id in (${sql.join(ebookIds.map((id) => sql`${id}::uuid`), sql`, `)})`));
  return new Map(rows.map(({ id, ...counts }) => [id, counts]));
}
