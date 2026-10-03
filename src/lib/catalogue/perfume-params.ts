import { PERFUME_CONCENTRATIONS, PERFUME_CONTAINERS } from "./perfumes";
import { PERFUME_SORTS, type PerfumeQuery } from "@/lib/validations/perfumes";
import type { ListSearchParams } from "@/lib/utils/pagination";

/**
 * The filters the perfume home reads from its URL, besides `q`, `sort`,
 * `order`, `page` and `perPage`. Several values of one key are a comma list.
 */
export const PERFUME_FILTER_KEYS = [
  "house",
  "perfumer",
  "family",
  "accord",
  "note",
  "concentration",
  "holding",
  "container",
  "favourite",
  "from",
  "to",
] as const;
export type PerfumeFilterKey = (typeof PERFUME_FILTER_KEYS)[number];

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
 * The list query of a perfume home URL. Unknown or malformed values are
 * dropped, never an error: a hand-edited or old link still opens the home.
 * Families, accords and notes must all match; houses, perfumers and
 * concentrations match any one listed.
 */
export function perfumeQueryFromParams(
  params: ListSearchParams,
): Omit<PerfumeQuery, "limit" | "offset"> {
  const ids = (key: PerfumeFilterKey) =>
    list(params, key).filter((v) => UUID.test(v));
  const taxonomyItemIds = [
    ...ids("family"),
    ...ids("accord"),
    ...ids("note"),
  ].slice(0, 50);
  const concentrations = list(params, "concentration").filter(
    (v): v is (typeof PERFUME_CONCENTRATIONS)[number] =>
      (PERFUME_CONCENTRATIONS as readonly string[]).includes(v),
  );
  const holdingValues = list(params, "holding");
  // Both "owned" and "not owned" is every perfume: no holding filter
  const holding =
    holdingValues.length === 1 &&
    (holdingValues[0] === "owned" || holdingValues[0] === "not_owned")
      ? holdingValues[0]
      : "any";
  const containers =
    holding === "not_owned"
      ? []
      : list(params, "container").filter(
          (v): v is (typeof PERFUME_CONTAINERS)[number] =>
            (PERFUME_CONTAINERS as readonly string[]).includes(v),
        );
  let from = year(first(params, "from"));
  let to = year(first(params, "to"));
  if (from !== undefined && to !== undefined && from > to) [from, to] = [to, from];
  const sort = first(params, "sort");
  const order = first(params, "order");
  const search = first(params, "q")?.trim().slice(0, 200);
  return {
    ...(search ? { search } : {}),
    ...(ids("house").length ? { houseIds: ids("house").slice(0, 50) } : {}),
    ...(ids("perfumer").length
      ? { perfumerIds: ids("perfumer").slice(0, 50) }
      : {}),
    ...(taxonomyItemIds.length ? { taxonomyItemIds } : {}),
    ...(concentrations.length ? { concentrations } : {}),
    ...(from !== undefined ? { releaseYearFrom: from } : {}),
    ...(to !== undefined ? { releaseYearTo: to } : {}),
    holding,
    ...(containers.length ? { containers } : {}),
    ...(first(params, "favourite") === "1" ? { favourite: true } : {}),
    sort:
      sort && (PERFUME_SORTS as readonly string[]).includes(sort)
        ? (sort as (typeof PERFUME_SORTS)[number])
        : "title",
    ...(order === "asc" || order === "desc" ? { order } : {}),
  };
}

/** Whether any filter of the perfume home is set (the search and sort are not filters). */
export function hasPerfumeFilters(params: ListSearchParams) {
  return PERFUME_FILTER_KEYS.some((key) => !!first(params, key));
}
