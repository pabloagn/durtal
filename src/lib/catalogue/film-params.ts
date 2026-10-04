import { FILM_HOLDING_MEDIA } from "./films";
import { FILM_SORTS, type FilmQuery } from "@/lib/validations/films";
import type { ListSearchParams } from "@/lib/utils/pagination";

/**
 * The filters the film home reads from its URL, besides `q`, `sort`,
 * `order`, `page` and `perPage`. Several values of one key are a comma list.
 */
export const FILM_FILTER_KEYS = [
  "director",
  "cast",
  "genre",
  "language",
  "country",
  "holding",
  "medium",
  "favourite",
  "from",
  "to",
] as const;
export type FilmFilterKey = (typeof FILM_FILTER_KEYS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(params: ListSearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}
function list(params: ListSearchParams, key: string) {
  return [...new Set((first(params, key) ?? "").split(",").filter(Boolean))];
}
function year(value: string | undefined) {
  if (!value || !/^-?\d{1,6}$/.test(value)) return undefined;
  const n = Number(value);
  return n === 0 ? undefined : n;
}

/**
 * The list query of a film home URL. Unknown or malformed values are
 * dropped, never an error: a hand-edited or old link still opens the home.
 * Genres must all match; directors, cast, languages and countries match any
 * one listed, and a director and a cast member must both match.
 */
export function filmQueryFromParams(
  params: ListSearchParams,
): Omit<FilmQuery, "limit" | "offset"> {
  const ids = (key: FilmFilterKey) =>
    list(params, key)
      .filter((v) => UUID.test(v))
      .slice(0, 50);
  const holdingValues = list(params, "holding");
  // Both "owned" and "not owned" is every film: no holding filter
  const holding =
    holdingValues.length === 1 &&
    (holdingValues[0] === "owned" || holdingValues[0] === "not_owned")
      ? holdingValues[0]
      : "any";
  const media =
    holding === "not_owned"
      ? []
      : list(params, "medium").filter(
          (v): v is (typeof FILM_HOLDING_MEDIA)[number] =>
            (FILM_HOLDING_MEDIA as readonly string[]).includes(v),
        );
  let from = year(first(params, "from"));
  let to = year(first(params, "to"));
  if (from !== undefined && to !== undefined && from > to) [from, to] = [to, from];
  const sort = first(params, "sort");
  const order = first(params, "order");
  const search = first(params, "q")?.trim().slice(0, 200);
  return {
    ...(search ? { search } : {}),
    ...(ids("director").length ? { directorIds: ids("director") } : {}),
    ...(ids("cast").length ? { castIds: ids("cast") } : {}),
    ...(ids("genre").length ? { taxonomyItemIds: ids("genre") } : {}),
    ...(ids("language").length ? { languageIds: ids("language") } : {}),
    ...(ids("country").length ? { countryIds: ids("country") } : {}),
    ...(from !== undefined ? { releaseYearFrom: from } : {}),
    ...(to !== undefined ? { releaseYearTo: to } : {}),
    holding,
    ...(media.length ? { media } : {}),
    ...(first(params, "favourite") === "1" ? { favourite: true } : {}),
    sort:
      sort && (FILM_SORTS as readonly string[]).includes(sort)
        ? (sort as (typeof FILM_SORTS)[number])
        : "title",
    ...(order === "asc" || order === "desc" ? { order } : {}),
  };
}

/** Whether any filter of the film home is set (the search and sort are not filters). */
export function hasFilmFilters(params: ListSearchParams) {
  return FILM_FILTER_KEYS.some((key) => !!first(params, key));
}
