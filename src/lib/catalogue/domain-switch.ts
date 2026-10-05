import { WORK_DOMAINS } from "./domains";
import type { WorkKind } from "./kinds";
import { FILM_SORTS } from "@/lib/validations/films";
import { PAINTING_SORTS } from "@/lib/validations/paintings";
import { PERFUME_SORTS } from "@/lib/validations/perfumes";
import { FILM_FILTER_KEYS } from "./film-params";
import { PAINTING_FILTER_KEYS } from "./painting-params";
import { PERFUME_FILTER_KEYS } from "./perfume-params";

/** The sorts of the book list (`/library?sort=`). */
export const BOOK_SORTS = [
  "title",
  "recent",
  "year",
  "rating",
  "authorFirstName",
  "authorLastName",
  "lastRead",
  "queue",
] as const;

/** The query each collection home reads, besides `q`, `sort`, `order`, `page` and `perPage`. */
const HOME_QUERY: Record<
  WorkKind,
  { sorts: readonly string[]; filters: readonly string[] }
> = {
  book: {
    sorts: BOOK_SORTS,
    filters: ["status", "priority", "mark", "rare", "publisher", "rating", "location", "poster", "reading", "readFrom", "readTo", "reread", "holding"],
  },
  perfume: { sorts: PERFUME_SORTS, filters: PERFUME_FILTER_KEYS },
  film: { sorts: FILM_SORTS, filters: FILM_FILTER_KEYS },
  painting: { sorts: PAINTING_SORTS, filters: PAINTING_FILTER_KEYS },
};

/**
 * The home of another collection, keeping only what it understands: the
 * search, its own filters, and the sort when it offers the same one. The page
 * and the page size start again: each home keeps its own saved size.
 */
export function domainSwitchHref(
  target: WorkKind,
  current: URLSearchParams,
): string {
  const { sorts, filters } = HOME_QUERY[target];
  const next = new URLSearchParams();
  for (const key of ["q", ...filters]) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  const sort = current.get("sort");
  if (sort && sorts.includes(sort)) {
    next.set("sort", sort);
    const order = current.get("order");
    if (order === "asc" || order === "desc") next.set("order", order);
  }
  const query = next.toString();
  return `${WORK_DOMAINS[target].basePath}${query ? `?${query}` : ""}`;
}
