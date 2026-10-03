/**
 * UI preferences (view mode, grid size, page size) live in cookies, so the
 * server renders the saved view on the first paint instead of the defaults.
 */

/** Every preference cookie starts with this prefix. */
export const PREFERENCE_COOKIE_PREFIX = "durtal-";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** The cookie that holds the page size picked on one list page. */
export function perPageCookieName(pathname: string): string {
  return `durtal-per-page${pathname.replace(/[^A-Za-z0-9-]/g, "_")}`;
}

/** Browser only. */
export function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix));
  if (entry === undefined) return undefined;
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return undefined;
  }
}

/** Browser only. */
export function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
}

/** Browser only. */
export function deleteCookie(name: string): void {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Browser only: the names of the preference cookies this browser holds. */
export function preferenceCookieNames(): string[] {
  return document.cookie
    .split("; ")
    .map((cookie) => cookie.slice(0, cookie.indexOf("=")))
    .filter((name) => name.startsWith(PREFERENCE_COOKIE_PREFIX));
}
