/**
 * The commonplace book's URL (SLN-453), read into a query: the search, the
 * filters, the sort and the page. Unknown and bad values are dropped, as
 * `parseJournalQuery` does. The filtered export of a later step reads the
 * same parameters.
 */
import { NOTE_KINDS, type NoteKind } from "./constants";
import { parsePagination, toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";

/** newest: the latest added first; book: by book, then page; relevance: the best match first (a search only) */
export const NOTES_SORTS = ["newest", "book", "relevance"] as const;
export type NotesSort = (typeof NOTES_SORTS)[number];

/** Each sort's own direction; the other one is ?order= */
export const NOTES_DEFAULT_ORDER: Record<NotesSort, "asc" | "desc"> = { newest: "desc", book: "asc", relevance: "desc" };

/** One page of the commonplace book without a saved page size; the page's size control offers the usual sizes */
export const NOTES_PER_PAGE = 48;

export interface NotesQuery {
  q?: string;
  workId?: string;
  authorId?: string;
  kind?: NoteKind;
  favourites: boolean;
  year?: number;
  sort: NotesSort;
  /** newest asc is oldest first; book desc runs the titles from Z (pages stay in order) */
  order: "asc" | "desc";
  page: number;
  perPage: number;
  offset: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: string | null) => (value && UUID.test(value) ? value.toLowerCase() : undefined);

export function parseNotesQuery(raw: ListSearchParams | URLSearchParams): NotesQuery {
  const params = toSearchParams(raw);
  const q = params.get("q")?.trim().slice(0, 200) || undefined;
  const kind = params.get("kind") ?? "";
  const yearParam = params.get("year") ?? "";
  const year = /^\d{4}$/.test(yearParam) && Number(yearParam) >= 1900 && Number(yearParam) < 3000 ? Number(yearParam) : undefined;
  const sortParam = params.get("sort") ?? "";
  // A search lists the best match first unless he chose a sort; best match means nothing without one
  let sort: NotesSort = (NOTES_SORTS as readonly string[]).includes(sortParam) ? (sortParam as NotesSort) : q ? "relevance" : "newest";
  if (sort === "relevance" && !q) sort = "newest";
  const orderParam = params.get("order");
  const order = sort !== "relevance" && (orderParam === "asc" || orderParam === "desc") ? orderParam : NOTES_DEFAULT_ORDER[sort];
  const { page, perPage, offset } = parsePagination(params, { defaultPerPage: NOTES_PER_PAGE });
  return {
    q,
    workId: uuid(params.get("book")),
    authorId: uuid(params.get("author")),
    kind: (NOTE_KINDS as readonly string[]).includes(kind) ? (kind as NoteKind) : undefined,
    favourites: params.get("fav") === "1",
    year,
    sort,
    order,
    page,
    perPage,
    offset,
  };
}

/** The URL of a query: only what differs from the defaults; the page resets unless given */
export function notesHref(query: Partial<NotesQuery>, base = "/reading/notes") {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.workId) params.set("book", query.workId);
  if (query.authorId) params.set("author", query.authorId);
  if (query.kind) params.set("kind", query.kind);
  if (query.favourites) params.set("fav", "1");
  if (query.year) params.set("year", String(query.year));
  const defaultSort = query.q ? "relevance" : "newest";
  if (query.sort && query.sort !== defaultSort) params.set("sort", query.sort);
  if (query.sort && query.order && query.order !== NOTES_DEFAULT_ORDER[query.sort]) params.set("order", query.order);
  if (query.perPage && query.perPage !== NOTES_PER_PAGE) params.set("perPage", String(query.perPage));
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}
