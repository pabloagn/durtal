/**
 * The reading journal's URL (SLN-448), read into a query. Unknown and bad
 * values are dropped, as `parsePublisherBookQuery` does.
 */
import { READING_FORMATS, READING_STATUSES, type ReadingFormat, type ReadingStatus } from "./constants";
import { parsePagination, toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";

export const JOURNAL_SORTS = ["finished", "started", "rating", "title"] as const;
export type JournalSort = (typeof JOURNAL_SORTS)[number];

export const JOURNAL_DEFAULT_ORDER: Record<JournalSort, "asc" | "desc"> = {
  finished: "desc",
  started: "desc",
  rating: "desc",
  title: "asc",
};

/** The minimum ratings offered: half stars from 0.5 to 5 */
export const JOURNAL_MIN_RATINGS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5] as const;

/** The page size without a saved one; the page's size control offers the usual sizes */
export const JOURNAL_PER_PAGE = 48;

export interface JournalQuery {
  q?: string;
  status: ReadingStatus[];
  yearMin?: number;
  yearMax?: number;
  formats: ReadingFormat[];
  minRating?: number;
  rereads: boolean;
  sort: JournalSort;
  order: "asc" | "desc";
  page: number;
  perPage: number;
  offset: number;
}

const list = (value: string | null) => value?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
const year = (value: string | null) => {
  const n = Number(value);
  return value && /^\d{1,4}$/.test(value) && n >= 1 && n < 3000 ? n : undefined;
};
const oneOf = <T extends string>(values: readonly T[], value: string) => (values as readonly string[]).includes(value);

export function parseJournalQuery(raw: ListSearchParams): JournalQuery {
  const params = toSearchParams(raw);
  const sortParam = params.get("sort") ?? "";
  const sort = oneOf(JOURNAL_SORTS, sortParam) ? (sortParam as JournalSort) : "finished";
  const orderParam = params.get("order");
  const rating = Number(params.get("minRating"));
  let yearMin = year(params.get("yearMin"));
  let yearMax = year(params.get("yearMax"));
  if (yearMin !== undefined && yearMax !== undefined && yearMin > yearMax) [yearMin, yearMax] = [yearMax, yearMin];
  const { page, perPage, offset } = parsePagination(raw, { defaultPerPage: JOURNAL_PER_PAGE });
  return {
    q: params.get("q")?.trim().slice(0, 200) || undefined,
    status: [...new Set(list(params.get("status")).filter((s): s is ReadingStatus => oneOf(READING_STATUSES, s)))],
    yearMin,
    yearMax,
    formats: [...new Set(list(params.get("format")).filter((f): f is ReadingFormat => oneOf(READING_FORMATS, f)))],
    minRating: (JOURNAL_MIN_RATINGS as readonly number[]).includes(rating) ? rating : undefined,
    rereads: params.get("rereads") === "1",
    sort,
    order: orderParam === "asc" || orderParam === "desc" ? orderParam : JOURNAL_DEFAULT_ORDER[sort],
    page,
    perPage,
    offset,
  };
}

/** The group a journal row sits in: "In progress", a year, or "Date unknown" */
export function journalGroup(row: { status: string; finishedOn: string | null }): string {
  if (row.status === "reading" || row.status === "paused") return "In progress";
  return row.finishedOn ? row.finishedOn.slice(0, 4) : "Date unknown";
}
