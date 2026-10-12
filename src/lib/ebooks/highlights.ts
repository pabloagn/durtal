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
/** Marks shown under each book; filtering to one book shows all of them up to the second bound. */
export const MARKS_PER_GROUP = 5;
export const MARKS_IN_ONE_BOOK = 500;

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
  const q = (params.get("q") ?? "").trim().slice(0, 200);
  const requested = params.get("sort");
  const sort: HighlightSort = HIGHLIGHT_SORTS.some((value) => value === requested) ? (requested as HighlightSort) : "newest";
  const rawOrder = params.get("order");
  const ebook = params.get("ebook");
  return {
    q,
    normalizedSearch: normalizeSearchText(q),
    colors: list(params, "color").filter((value): value is AnnotationColor => ANNOTATION_COLORS.some((color) => color === value)),
    kinds: list(params, "kind").filter((value): value is HighlightKind => HIGHLIGHT_KINDS.some((kind) => kind === value)),
    ebookId: ebook && isUuid(ebook) ? ebook.toLowerCase() : null,
    sort,
    order: rawOrder === "asc" || rawOrder === "desc" ? rawOrder : sort === "newest" ? "desc" : "asc",
    ...parsePagination(params),
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

const markColumns = sql`m.id, m.kind, m.style, m.color, m.text, m.note, m.chapter,
  m.locator->>'pageLabel' as "pageLabel", m.progression, m.anchor_state as "anchorState",
  to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt"`;

/** One page of books with marks, newest mark first, each with its newest marks. */
export function highlightGroupsQuery(params: HighlightParams): SQL {
  const perGroup = params.ebookId ? MARKS_IN_ONE_BOOK : MARKS_PER_GROUP;
  return sql`with marks as (
    select a.* from ebook_annotations a where ${highlightWhere(params)}
  ), g as (
    select ebook_id, count(*)::integer as total, max(updated_at) as latest from marks group by ebook_id
  ), page as (
    select g.ebook_id, g.total, g.latest from g join ebooks e on e.id = g.ebook_id
    order by ${groupOrder(params, sql`g`)} limit ${params.perPage} offset ${params.offset}
  ) select ${ebookSummaryColumns}, page.total,
    coalesce((select json_agg(json_build_object(
      'id', m.id, 'kind', m.kind, 'style', m.style, 'color', m.color, 'text', m.text, 'note', m.note,
      'chapter', m.chapter, 'pageLabel', m."pageLabel", 'progression', m.progression,
      'anchorState', m."anchorState", 'updatedAt', m."updatedAt") order by m."updatedAt" desc, m.id)
      from (select ${markColumns} from marks m where m.ebook_id = page.ebook_id
        order by m.updated_at desc, m.id limit ${perGroup}) m), '[]'::json) as marks
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
