import { PAINTING_SORTS, type PaintingQuery } from "@/lib/validations/paintings";
import type { ListSearchParams } from "@/lib/utils/pagination";

/**
 * The filters the painting home reads from its URL, besides `q`, `sort`,
 * `order`, `page` and `perPage`. Several values of one key are a comma list.
 */
export const PAINTING_FILTER_KEYS = [
  "painter",
  "movement",
  "genre",
  "technique",
  "medium",
  "support",
  "institution",
  "venue",
  "holding",
  "favourite",
  "from",
  "to",
] as const;
export type PaintingFilterKey = (typeof PAINTING_FILTER_KEYS)[number];

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
 * The list query of a painting home URL. Unknown or malformed values are
 * dropped, never an error: a hand-edited or old link still opens the home.
 * Genres, techniques, media and supports must all match; painters,
 * movements, institutions and venues match any one listed.
 */
export function paintingQueryFromParams(
  params: ListSearchParams,
): Omit<PaintingQuery, "limit" | "offset"> {
  const ids = (key: PaintingFilterKey) =>
    list(params, key)
      .filter((v) => UUID.test(v))
      .slice(0, 50);
  // One item listed under two keys is one condition
  const taxonomyItemIds = [
    ...new Set([...ids("genre"), ...ids("technique"), ...ids("medium"), ...ids("support")]),
  ].slice(0, 50);
  const holdingValues = list(params, "holding");
  // Both "owned" and "not owned" is every painting: no holding filter
  const holding =
    holdingValues.length === 1 &&
    (holdingValues[0] === "owned" || holdingValues[0] === "not_owned")
      ? holdingValues[0]
      : "any";
  let from = year(first(params, "from"));
  let to = year(first(params, "to"));
  if (from !== undefined && to !== undefined && from > to) [from, to] = [to, from];
  const sort = first(params, "sort");
  const order = first(params, "order");
  const search = first(params, "q")?.trim().slice(0, 200);
  return {
    ...(search ? { search } : {}),
    ...(ids("painter").length ? { painterIds: ids("painter") } : {}),
    ...(ids("movement").length ? { artMovementIds: ids("movement") } : {}),
    ...(taxonomyItemIds.length ? { taxonomyItemIds } : {}),
    ...(ids("institution").length
      ? { ownerOrganizationIds: ids("institution") }
      : {}),
    ...(ids("venue").length ? { currentVenueIds: ids("venue") } : {}),
    ...(from !== undefined ? { createdFrom: from } : {}),
    ...(to !== undefined ? { createdTo: to } : {}),
    holding,
    ...(first(params, "favourite") === "1" ? { favourite: true } : {}),
    sort:
      sort && (PAINTING_SORTS as readonly string[]).includes(sort)
        ? (sort as (typeof PAINTING_SORTS)[number])
        : "title",
    ...(order === "asc" || order === "desc" ? { order } : {}),
  };
}

/** Whether any filter of the painting home is set (the search and sort are not filters). */
export function hasPaintingFilters(params: ListSearchParams) {
  return PAINTING_FILTER_KEYS.some((key) => !!first(params, key));
}
