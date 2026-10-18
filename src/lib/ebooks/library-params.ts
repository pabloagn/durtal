import { EBOOK_FORMATS, type EbookFormat } from "./formats";
import { normalizeLanguage } from "@/lib/utils/language";
import { normalizeSearchText } from "@/lib/utils/search-text";
import {
  parsePagination,
  toSearchParams,
  type ListSearchParams,
} from "@/lib/utils/pagination";

export const EBOOK_LIBRARY_SORTS = [
  "title",
  "author",
  "added",
  "opened",
  "size",
  "format",
  "language",
  "linked",
] as const;
export type EbookLibrarySort = (typeof EBOOK_LIBRARY_SORTS)[number];
export type EbookLinkedFilter = "linked" | "unlinked" | "standalone";
export interface EbookLibraryParams {
  q: string;
  normalizedSearch: string;
  state: "active" | "excluded";
  linked: EbookLinkedFilter[];
  formats: EbookFormat[];
  languages: string[];
  drm: boolean | null;
  needsReview: boolean | null;
  sort: EbookLibrarySort;
  explicitSort: boolean;
  order: "asc" | "desc";
  page: number;
  perPage: number;
  offset: number;
}

/** Bounded URL alternatives within a group; groups combine with AND. */
function list(params: URLSearchParams, key: string): string[] {
  return [
    ...new Set(
      params
        .getAll(key)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, 100);
}
const yesNo = (value: string | null) =>
  value === "yes" ? true : value === "no" ? false : null;

/** Own URL contract only; matching/review payloads remain owned by SLN-496. */
export function parseEbookLibraryParams(
  input: ListSearchParams | URLSearchParams,
): EbookLibraryParams {
  const params = toSearchParams(input);
  // A NUL can't reach Postgres text: the search drops it rather than failing (SLN-933)
  const q = (params.get("q") ?? "").replaceAll("\u0000", "").trim().slice(0, 200);
  const requestedSort = params.get("sort");
  const explicitSort = EBOOK_LIBRARY_SORTS.some(
    (sort) => sort === requestedSort,
  );
  const sort = explicitSort ? (requestedSort as EbookLibrarySort) : "title";
  const rawOrder = params.get("order");
  const fallback = ["added", "opened", "size"].includes(sort) ? "desc" : "asc";
  return {
    q,
    normalizedSearch: normalizeSearchText(q),
    state: params.get("state") === "excluded" ? "excluded" : "active",
    linked: list(params, "linked").filter((value): value is EbookLinkedFilter =>
      ["linked", "unlinked", "standalone"].includes(value),
    ),
    formats: list(params, "format").filter((value): value is EbookFormat =>
      EBOOK_FORMATS.some((format) => format === value),
    ),
    languages: [
      ...new Set(
        list(params, "language")
          .map(normalizeLanguage)
          .filter((value): value is string => !!value),
      ),
    ],
    drm: yesNo(params.get("drm")),
    needsReview: yesNo(params.get("review")),
    sort,
    explicitSort,
    order: rawOrder === "asc" || rawOrder === "desc" ? rawOrder : fallback,
    ...parsePagination(params),
  };
}
