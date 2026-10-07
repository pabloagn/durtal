import { isBlockedHost } from "@/lib/net/safe-fetch-page";
import { canonicalEvidenceUrl } from "../evidence-url";
import { outletForUrl, type Outlet } from "../outlets";
import { RESEARCH_CONFIG } from "./config";
import type { SearchResult } from "./search";

/*
 * Which search results the research agent may store (SLN-469, section 2):
 * only pages of an active registry outlet; never a blocked host (Goodreads,
 * StoryGraph) or an excluded outlet (R10). Equal URLs merge after the
 * evidence store's canonical form. Ordered by outlet weight, then by the best
 * search rank; at most `maxPerOutlet` per outlet.
 */

export interface Candidate {
  url: string;
  title: string | null;
  outlet: Outlet;
  /** The best rank any query gave it */
  rank: number;
  snippet: string | null;
  /** The query and provider whose result it was, for a stored snippet */
  query: string;
  provider: string;
}

export interface Ranking {
  candidates: Candidate[];
  /** Results left out, by reason */
  dropped: Record<"blocked_host" | "off_registry" | "outlet_excluded" | "bad_url", number>;
}

/** The allowlisted candidates of some results, best first, within the per-outlet limit */
export function rankCandidates(results: { query: string; provider: string; result: SearchResult }[], outlets: readonly Outlet[]): Ranking {
  const dropped: Ranking["dropped"] = { blocked_host: 0, off_registry: 0, outlet_excluded: 0, bad_url: 0 };
  const byUrl = new Map<string, Candidate>();
  // A result many queries return is counted once
  const seenDropped = new Set<string>();
  const drop = (reason: keyof Ranking["dropped"], url: string) => {
    if (!seenDropped.has(url)) dropped[reason]++;
    seenDropped.add(url);
  };
  for (const { query, provider, result } of results) {
    let url: URL;
    try {
      url = new URL(result.url);
    } catch {
      drop("bad_url", result.url);
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      drop("bad_url", result.url);
      continue;
    }
    if (isBlockedHost(url.hostname)) {
      drop("blocked_host", result.url);
      continue;
    }
    const outlet = outletForUrl(url, outlets);
    if (!outlet) {
      drop("off_registry", result.url);
      continue;
    }
    if (outlet.fetchPolicy === "excluded") {
      drop("outlet_excluded", result.url);
      continue;
    }
    const canonical = canonicalEvidenceUrl(url.toString());
    const seen = byUrl.get(canonical);
    if (!seen || result.rank < seen.rank)
      byUrl.set(canonical, { url: canonical, title: result.title, outlet, rank: result.rank, snippet: result.snippet, query, provider });
  }
  const ordered = [...byUrl.values()].sort((a, b) => b.outlet.weight - a.outlet.weight || a.rank - b.rank || a.url.localeCompare(b.url));
  const perOutlet = new Map<string, number>();
  const candidates = ordered.filter((c) => {
    const taken = perOutlet.get(c.outlet.key) ?? 0;
    if (taken >= RESEARCH_CONFIG.maxPerOutlet) return false;
    perOutlet.set(c.outlet.key, taken + 1);
    return true;
  });
  return { candidates, dropped };
}
