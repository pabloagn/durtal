import { pageHref } from "./pagination";
/**
 * URL helpers for list pages (/authors, /places, /library) that keep their
 * search, filters, sort and page in the query string.
 */

/** Params that describe how a list is shown, not what it contains. */
const PRESENTATION_PARAMS = ["sort", "order", "perPage"];

/**
 * Build the list URL with the search and every filter removed.
 * Sort and order are kept; the page resets to 1.
 */
export function clearedListHref(
  basePath: string,
  params: URLSearchParams | { toString(): string },
): string {
  const current = new URLSearchParams(params.toString());
  const next = new URLSearchParams();
  for (const key of PRESENTATION_PARAMS) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Build the list URL for the first page, keeping everything else. */
export function firstPageHref(
  basePath: string,
  params: URLSearchParams | { toString(): string },
): string {
  return pageHref(basePath, params, 1);
}

/**
 * True when the query string narrows the list: a search term or any param
 * other than sort, order and page.
 */
export function hasListQuery(params: URLSearchParams | { toString(): string }): boolean {
  const current = new URLSearchParams(params.toString());
  for (const [key, value] of current) {
    if (!value) continue;
    if (key === "page" || PRESENTATION_PARAMS.includes(key)) continue;
    return true;
  }
  return false;
}
