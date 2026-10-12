import { LOOKUP_LIMITS } from "./policy";

export const WIKIMEDIA_RELAY_PATH = "/api/reader/lookup/wikimedia";
export const WIKIMEDIA_RELAY_ERROR = "X-Durtal-Lookup-Error";
export const WIKIMEDIA_REQUEST_BYTES = 32 * 1024;

export type WikimediaRequest = {
  operation: "definition" | "summary" | "parse";
  language: string;
  title: string;
};

const parseParameters = {
  action: "parse",
  format: "json",
  formatversion: "2",
  origin: "*",
  redirects: "1",
  prop: "text",
  disableeditsection: "1",
  disabletoc: "1",
} as const;

/** The relay accepts data describing one operation, never an acquisition URL. */
export function wikimediaRequest(value: unknown): WikimediaRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Wikimedia request");
  const keys = Object.keys(value);
  const request = value as Record<string, unknown>;
  if (
    keys.length !== 3 ||
    !keys.every((key) => ["operation", "language", "title"].includes(key)) ||
    !["definition", "summary", "parse"].includes(String(request.operation)) ||
    typeof request.operation !== "string" ||
    typeof request.language !== "string" ||
    !/^[a-z]{2,3}$/.test(request.language) ||
    typeof request.title !== "string" ||
    !request.title ||
    request.title.length > 4096
  )
    throw new Error("Invalid Wikimedia request");
  return request as WikimediaRequest;
}

/** Encoding and normalization must leave the internally chosen endpoint intact. */
export function wikimediaAddress(value: WikimediaRequest): string {
  const request = wikimediaRequest(value);
  const wiki = request.operation === "summary" ? "wikipedia" : "wiktionary";
  const origin = `https://${request.language}.${wiki}.org`;
  const path = request.operation === "parse"
    ? "/w/api.php"
    : `/api/rest_v1/page/${request.operation}/${encodeURIComponent(request.title)}`;
  const url = new URL(path, origin);
  if (url.origin !== origin || url.pathname !== path)
    throw new Error("Invalid Wikimedia acquisition endpoint");
  if (request.operation === "parse")
    url.search = new URLSearchParams({ ...parseParameters, page: request.title }).toString();
  return url.href;
}

/** Decode a REST title once; a slash or percent stays data on reconstruction. */
export function wikimediaRequestFromAddress(value: string): WikimediaRequest {
  const url = new URL(value);
  const host = /^([a-z]{2,3})\.(wiktionary|wikipedia)\.org$/.exec(url.hostname);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !host)
    throw new Error("Invalid Wikimedia acquisition address");
  let operation: WikimediaRequest["operation"], title: string;
  if (host[2] === "wiktionary" && url.pathname === "/w/api.php") {
    const entries = [...url.searchParams];
    if (
      entries.length !== Object.keys(parseParameters).length + 1 ||
      new Set(entries.map(([key]) => key)).size !== entries.length ||
      !entries.every(([key, value]) => key === "page" ||
        (key in parseParameters && parseParameters[key as keyof typeof parseParameters] === value))
    )
      throw new Error("Invalid Wikimedia acquisition endpoint");
    operation = "parse";
    title = url.searchParams.get("page") ?? "";
  } else {
    operation = host[2] === "wiktionary" ? "definition" : "summary";
    const path = new RegExp(`^/api/rest_v1/page/${operation}/([^/]+)$`).exec(url.pathname);
    if (!path || url.search) throw new Error("Invalid Wikimedia acquisition endpoint");
    try { title = decodeURIComponent(path[1]); }
    catch { throw new Error("Invalid Wikimedia acquisition endpoint"); }
  }
  const request = wikimediaRequest({ operation, language: host[1], title });
  wikimediaAddress(request);
  return request;
}

export function wikimediaResponseBytes(request: WikimediaRequest): number {
  return request.operation === "parse" ? LOOKUP_LIMITS.parseResponseBytes : LOOKUP_LIMITS.responseBytes;
}
