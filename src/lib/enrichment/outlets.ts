/**
 * The outlet registry (SLN-468): the allowlist of outlets whose pages may
 * serve as evidence, with a weight, a syndication group and a fetch policy.
 * The rows live in `evidence_outlets`, seeded from outlets-seed.ts.
 */

export const OUTLET_KINDS = ["review", "essay", "publisher", "translator", "academic", "press"] as const;
export const FETCH_POLICIES = ["fetch", "snippet_only", "excluded"] as const;
export const OUTLET_STATUSES = ["active", "retired"] as const;

/**
 * Providers that are not outlets: an outlet key never takes one of these, so
 * evidence from an API never reads as a page of an outlet. A later issue
 * that adds a provider adds it here.
 */
export const RESERVED_OUTLET_KEYS = [
  "wikidata",
  "open_library",
  "isbndb",
  "google_books",
  "wikipedia",
  "library_of_congress",
  "wikimedia_pageviews",
  "durtal_research",
  "storygraph_export",
  "manual",
] as const;

/** A slug with no dot, so it never equals a host that citeSource stores as a provider */
export const OUTLET_KEY = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

export interface Outlet {
  key: string;
  name: string;
  /** Lowercase host names; a domain matches itself and its subdomains */
  domains: string[];
  kind: (typeof OUTLET_KINDS)[number];
  /** ISO 639-1; null when the outlet writes in several */
  language: string | null;
  weight: number;
  /** Outlets of one group count as one source for R6 */
  syndicationGroup: string | null;
  fetchPolicy: (typeof FETCH_POLICIES)[number];
  termsUrl: string | null;
  termsCheckedOn: string | null;
  termsNote: string | null;
  status: (typeof OUTLET_STATUSES)[number];
}

const hostOf = (url: URL | string) => (typeof url === "string" ? new URL(url) : url).hostname.toLowerCase().replace(/\.$/, "");

/** The active outlet with the longest domain that matches the URL's host, or null */
export function outletForUrl<T extends Pick<Outlet, "domains" | "status">>(url: URL | string, outlets: readonly T[]): T | null {
  const host = hostOf(url);
  let best: { outlet: T; length: number } | null = null;
  for (const outlet of outlets) {
    if (outlet.status !== "active") continue;
    for (const domain of outlet.domains)
      if ((host === domain || host.endsWith(`.${domain}`)) && (!best || domain.length > best.length)) best = { outlet, length: domain.length };
  }
  return best?.outlet ?? null;
}

/** What is wrong with a seed: a bad key, a reserved key, a domain listed twice, a fetch policy without checked terms */
export function seedProblems(seed: readonly Outlet[]): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  const domains = new Map<string, string>();
  for (const outlet of seed) {
    if (!OUTLET_KEY.test(outlet.key)) problems.push(`${outlet.key}: a key is a slug with no dot`);
    if ((RESERVED_OUTLET_KEYS as readonly string[]).includes(outlet.key)) problems.push(`${outlet.key}: a reserved provider name`);
    if (keys.has(outlet.key)) problems.push(`${outlet.key}: listed twice`);
    keys.add(outlet.key);
    if (outlet.weight < 0 || outlet.weight > 1) problems.push(`${outlet.key}: the weight is between 0 and 1`);
    if (outlet.fetchPolicy === "fetch" && !outlet.termsCheckedOn) problems.push(`${outlet.key}: fetch needs the day its terms were checked`);
    for (const domain of outlet.domains) {
      if (domain !== domain.toLowerCase() || !/^[a-z0-9.-]+\.[a-z]+$/.test(domain)) problems.push(`${outlet.key}: ${domain} is not a lowercase host name`);
      const other = domains.get(domain);
      if (other) problems.push(`${outlet.key}: ${domain} is also ${other}'s`);
      domains.set(domain, outlet.key);
    }
  }
  return problems;
}

/** The rows a seed adds, changes and retires against the registry: the plan of `--outlets` */
export function planOutletSeed(current: readonly Outlet[], seed: readonly Outlet[]) {
  const byKey = new Map(current.map((o) => [o.key, o]));
  const seedKeys = new Set(seed.map((o) => o.key));
  const added = seed.filter((o) => !byKey.has(o.key));
  const changed = seed.flatMap((after) => {
    const before = byKey.get(after.key);
    return before && JSON.stringify(before) !== JSON.stringify(after) ? [{ before, after }] : [];
  });
  // An outlet that leaves the seed is retired, never deleted: stored documents cite it
  const retired = current.filter((o) => !seedKeys.has(o.key) && o.status === "active");
  return { added, changed, retired };
}
