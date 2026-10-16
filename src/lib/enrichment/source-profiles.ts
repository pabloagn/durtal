/**
 * Retrieval and content expectations, not permission to fetch a source.
 * The existing outlet registry, robots policy and cost limits still apply.
 * Authority-field interpretation belongs to the facts stage (SLN-465).
 */
export const SOURCE_PROFILE_VERSION = "sln969.1";

export type SourceRoute = "article" | "publisher" | "open-library" | "bnf-sru";
export type SourceField = "mainText" | "record" | "title" | "description" | "contributors" | "identifiers" | "publication" | "language" | "extent";
export interface SourceProfile {
  key: SourceRoute;
  version: string;
  required: readonly SourceField[];
  supported: readonly SourceField[];
  retention: "outlet-policy";
  /** At most one alternative, only after an empty structured record. */
  maxAlternatives: number;
}

const profiles: Record<SourceRoute, SourceProfile> = {
  article: {
    key: "article",
    version: SOURCE_PROFILE_VERSION,
    required: ["mainText"],
    supported: ["mainText", "title", "contributors", "publication", "language"],
    retention: "outlet-policy",
    maxAlternatives: 0,
  },
  publisher: {
    key: "publisher",
    version: SOURCE_PROFILE_VERSION,
    required: ["title", "description"],
    supported: ["title", "description", "contributors", "identifiers", "publication", "language", "extent", "mainText"],
    retention: "outlet-policy",
    maxAlternatives: 0,
  },
  "open-library": {
    key: "open-library",
    version: SOURCE_PROFILE_VERSION,
    required: ["record", "title"],
    supported: ["record", "title", "description", "contributors", "identifiers", "publication", "language", "extent"],
    retention: "outlet-policy",
    maxAlternatives: 0,
  },
  "bnf-sru": {
    key: "bnf-sru",
    version: SOURCE_PROFILE_VERSION,
    required: ["record"],
    supported: ["record", "title", "contributors", "identifiers", "publication", "language", "extent"],
    retention: "outlet-policy",
    maxAlternatives: 1,
  },
};

const publishers = ["penguin.co.uk", "penguinrandomhouse.com", "ndbooks.com", "pushkinpress.com", "dalkeyarchive.com", "dalkeyarchive.store"];
const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function sourceProfile(url: string, kind?: string): SourceProfile {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (host === "openlibrary.org" && /^\/(?:works\/OL\d+W|books\/OL\d+M|isbn\/[0-9Xx-]+)(?:[/.]|$)/.test(u.pathname)) return profiles["open-library"];
  if (host === "catalogue.bnf.fr" && (/^\/ark:\/12148\/cb[0-9a-z]+/.test(u.pathname) || u.pathname === "/api/SRU")) return profiles["bnf-sru"];
  return profiles[kind === "publisher" || publishers.some((domain) => isHost(host, domain)) ? "publisher" : "article"];
}

/** Canonical machine-readable routes; never guesses an edition from a title. */
export function sourceRequests(url: string, kind?: string): { profile: SourceProfile; urls: string[] } {
  const profile = sourceProfile(url, kind);
  const u = new URL(url);
  if (profile.key === "open-library") {
    const path = /^\/(works\/OL\d+W|books\/OL\d+M|isbn\/[0-9Xx-]+)/.exec(u.pathname)![1];
    return { profile, urls: [`${u.origin}/${path}.json`] };
  }
  if (profile.key === "bnf-sru" && u.pathname !== "/api/SRU") {
    const ark = /^\/ark:\/12148\/(cb[0-9a-z]+)/.exec(u.pathname)![1];
    return {
      profile,
      urls: ["bib", "aut"].map((type) => {
        const endpoint = new URL("/api/SRU", u.origin);
        endpoint.search = new URLSearchParams({
          version: "1.2",
          operation: "searchRetrieve",
          query: `${type}.persistentid any "ark:/12148/${ark}"`,
          recordSchema: "unimarcXchange",
          maximumRecords: "1",
        }).toString();
        return endpoint.href;
      }),
    };
  }
  return { profile, urls: [url] };
}

/** Structured response types are accepted only at an explicitly known API URL. */
export function structuredSourceType(url: string): "json" | "xml" | null {
  const profile = sourceProfile(url);
  const u = new URL(url);
  if (profile.key === "open-library" && u.pathname.endsWith(".json")) return "json";
  if (profile.key === "bnf-sru" && u.pathname === "/api/SRU") return "xml";
  return null;
}
