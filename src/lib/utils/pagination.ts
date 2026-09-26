export const PAGE_SIZES = [24, 48, 96, 192] as const;
export type ListSearchParams = Record<string, string | string[] | undefined>;
type Params = ListSearchParams | { toString(): string };

export function toSearchParams(params: Params): URLSearchParams {
  if (
    "get" in params &&
    typeof params.get === "function" &&
    typeof params.toString === "function"
  ) {
    return new URLSearchParams(params.toString());
  }
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => result.append(key, v));
    else if (typeof value === "string") result.set(key, value);
  }
  return result;
}

export function parsePagination(
  params: Params,
  options: { defaultPerPage?: number; allowedPerPage?: readonly number[] } = {},
) {
  const query = toSearchParams(params);
  const allowed = options.allowedPerPage ?? PAGE_SIZES;
  const fallback = options.defaultPerPage ?? 48;
  const size = Number(query.get("perPage"));
  const perPage = allowed.includes(size) ? size : fallback;
  const raw = query.get("page") ?? "1";
  const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
  // Bound offsets to PostgreSQL's integer range before any query is executed.
  const page =
    Number.isSafeInteger(parsed) &&
    parsed >= 1 &&
    (parsed - 1) * perPage <= 2_147_483_647
      ? parsed
      : 1;
  return { page, perPage, offset: (page - 1) * perPage };
}

export function lastPage(total: number, perPage: number) {
  return Math.max(1, Math.ceil(total / perPage));
}

export function pageHref(
  pathname: string,
  current: Params,
  page: number,
  perPage?: number,
): string {
  const params = toSearchParams(current);
  if (page <= 1) params.delete("page");
  else params.set("page", String(page));
  if (perPage !== undefined) params.set("perPage", String(perPage));
  return params.size ? `${pathname}?${params}` : pathname;
}

export function getPageRange(
  current: number,
  total: number,
  siblings = 2,
): (number | "ellipsis")[] {
  total = Math.max(1, Math.floor(total));
  current = Math.max(1, Math.min(total, current));
  const pages = new Set([1, total]);
  for (
    let p = Math.max(1, current - siblings);
    p <= Math.min(total, current + siblings);
    p++
  )
    pages.add(p);
  const result: (number | "ellipsis")[] = [];
  let previous = 0;
  for (const p of [...pages].sort((a, b) => a - b)) {
    if (p - previous === 2) result.push(previous + 1);
    else if (p - previous > 2) result.push("ellipsis");
    result.push(p);
    previous = p;
  }
  return result;
}

/** Paginate already-loaded small collections without altering their ordering. */
export function paginateItems<T>(items: T[], params: Params) {
  const parsed = parsePagination(params);
  const total = items.length;
  const page = Math.min(parsed.page, lastPage(total, parsed.perPage));
  const offset = (page - 1) * parsed.perPage;
  return {
    page,
    perPage: parsed.perPage,
    total,
    items: items.slice(offset, offset + parsed.perPage),
  };
}
