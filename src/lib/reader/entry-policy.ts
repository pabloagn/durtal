import { isUuid } from "@/lib/utils/uuid";
import { isDeviceId } from "./device";

const origin = "https://durtal.invalid";
const returnRoutes = [
  "/library",
  "/ebooks",
  "/people",
  "/series",
  "/collections",
  "/publishers",
  "/taxonomy",
  "/recommenders",
  "/reading",
];

/** A same-app catalogue destination, including its filters and copy/section anchor. */
export function readerReturnDestination(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return null;
  // Encoded separators/control characters must not change the route after decoding.
  const path = value.split(/[?#]/, 1)[0];
  if (/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f|25)/i.test(path)) return null;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (
    url.origin !== origin ||
    !(
      url.pathname === "/" ||
      returnRoutes.some(
        (route) =>
          url.pathname === route || url.pathname.startsWith(`${route}/`),
      )
    )
  )
    return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Reader routes alone get document navigation, so the response supplies its CSP. */
export function readerEntryPolicy(
  readerPath: string,
  returnTo: unknown,
): {
  readonly readerPath: string;
  readonly returnTo: string | null;
  readonly navigation: "document";
} | null {
  if (
    !readerPath.startsWith("/reader/") ||
    /[\\\u0000-\u0020\u007f]/.test(readerPath)
  )
    return null;
  let url: URL;
  try {
    url = new URL(readerPath, origin);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/");
  if (
    url.origin !== origin ||
    parts.length !== 3 ||
    parts[1] !== "reader" ||
    !isUuid(parts[2]) ||
    url.hash
  )
    return null;
  const query = [...url.searchParams.entries()];
  // A file to open, and a device whose place to open at (SLN-665), each at most once
  const allowed: Record<string, (value: string) => boolean> = { file: isUuid, from: isDeviceId };
  if (
    new Set(query.map(([key]) => key)).size !== query.length ||
    query.some(([key, value]) => !Object.hasOwn(allowed, key) || !allowed[key](value))
  )
    return null;
  return {
    readerPath: `${url.pathname}${url.search}`,
    returnTo: readerReturnDestination(returnTo),
    navigation: "document",
  };
}

/** One URL contract for full reader navigation and the reader page's Back link. */
export function readerEntryHref(
  readerPath: string,
  returnTo: unknown,
): string | null {
  const entry = readerEntryPolicy(readerPath, returnTo);
  if (!entry) return null;
  const url = new URL(entry.readerPath, origin);
  if (entry.returnTo) url.searchParams.set("returnTo", entry.returnTo);
  return `${url.pathname}${url.search}`;
}
