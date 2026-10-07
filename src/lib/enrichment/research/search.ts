import { createHash } from "node:crypto";
import { z } from "zod";
import { fetchWithTimeout, serialThrottle } from "@/lib/api/external-fetch";
import { stableStringify } from "@/lib/harmonization/normalize";
import type { Db } from "@/lib/catalogue/work-store";
import { enrichmentUserAgent } from "../user-agent";
import { costOf, priceFor } from "../prices";
import { metered, monthSpend, WorkCeilingStop } from "../meter";
import { QuotaStop, type SourceCache } from "../source-cache";
import { RESEARCH_CONFIG } from "./config";

/*
 * The research agent's search providers (SLN-461's choice, SLN-469 section 2):
 * Tavily's search API is the main one, Brave Search the fallback. Plain HTTPS
 * through fetchWithTimeout and serialThrottle, answers parsed with zod, the
 * enrichment User-Agent on every call, every call through the cost meter. A
 * result keeps its URL, title and rank. The page text or the written answer a
 * provider can return is never asked for and never used: pages are fetched
 * through the evidence store. Snippets stay off until docs/08 records a
 * provider's terms as allowing storage and LLM use, and its snippet as text
 * copied from the page.
 */

export interface SearchResult {
  url: string;
  title: string | null;
  /** 1 for the provider's first result */
  rank: number;
  /** Kept only when the provider's terms allow storing it */
  snippet: string | null;
}

export interface SearchRequest {
  text: string;
  /** Outlet domains, highest weight first: the provider takes as many as its filter does */
  domains: string[];
}

/** A provider refused the call: a rate limit, a quota or a key it does not accept */
export class SearchRefusal extends Error {
  readonly billed = false;
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly reason: "quota" | "rate_limited",
  ) {
    super(`${provider} refused a search (HTTP ${status})`);
    this.name = "SearchRefusal";
  }
}

/** A call that got no usable answer (a network error, a 5xx, an answer that does not parse) */
export class SearchFailure extends Error {
  constructor(
    readonly provider: string,
    readonly status: number | null,
  ) {
    super(status ? `${provider} answered with status ${status}` : `${provider} could not be reached`);
    this.name = "SearchFailure";
  }
}

export interface SearchProvider {
  /** The meter's provider name and the price table's */
  key: "tavily" | "brave";
  name: string;
  envKey: "TAVILY_API_KEY" | "BRAVE_SEARCH_API_KEY";
  /** Domains one query can be restricted to */
  capacity: number;
  /** The units one search is billed */
  units: Record<string, number>;
  /** SLN-461's record of the provider's terms (docs/08): both must hold before a snippet is used */
  snippets: { storable: boolean; copiedFromPage: boolean };
  search(request: SearchRequest, key: string): Promise<SearchResult[]>;
}

/** Logs a failed call like reportSearchFailure: the provider and the status, never a URL, key or body */
function reportFailure(provider: string, status: number | "request_failed") {
  console.warn(`[research] ${provider}: ${typeof status === "number" ? `HTTP ${status}` : "request failed"}`);
}

async function call(provider: string, request: () => Promise<Response>, refusals: Record<number, "quota" | "rate_limited">) {
  let res: Response;
  try {
    res = await request();
  } catch {
    reportFailure(provider, "request_failed");
    throw new SearchFailure(provider, null);
  }
  if (res.ok) return res.json();
  await res.arrayBuffer().catch(() => undefined);
  reportFailure(provider, res.status);
  const reason = refusals[res.status];
  if (reason) throw new SearchRefusal(provider, res.status, reason);
  throw new SearchFailure(provider, res.status);
}

const tavilyAnswer = z.object({
  results: z.array(z.object({ url: z.string(), title: z.string().nullish(), content: z.string().nullish() })),
});

/** Tavily: POST /search, basic depth (1 credit), its domain filter, no answer and no page text */
export const tavily: SearchProvider = {
  key: "tavily",
  name: "Tavily",
  envKey: "TAVILY_API_KEY",
  capacity: 300,
  units: { credits: 1 },
  snippets: { storable: false, copiedFromPage: false },
  async search(request, key) {
    const body = await call(
      "tavily",
      () =>
        fetchWithTimeout(
          "https://api.tavily.com/search",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": enrichmentUserAgent() },
            body: JSON.stringify({
              query: request.text,
              search_depth: "basic",
              max_results: RESEARCH_CONFIG.resultsPerQuery,
              include_answer: false,
              include_raw_content: false,
              include_images: false,
              ...(request.domains.length ? { include_domains: request.domains.slice(0, 300) } : {}),
            }),
          },
          20_000,
        ),
      { 401: "quota", 403: "quota", 429: "rate_limited", 432: "quota", 433: "quota" },
    );
    const parsed = tavilyAnswer.safeParse(body);
    if (!parsed.success) throw new SearchFailure("tavily", null);
    return parsed.data.results.map((r, i) => ({ url: r.url, title: r.title ?? null, rank: i + 1, snippet: r.content ?? null }));
  },
};

const braveAnswer = z.object({
  web: z.object({ results: z.array(z.object({ url: z.string(), title: z.string().nullish(), description: z.string().nullish() })) }).optional(),
});
/** site: terms per query: Brave has no domain filter, and a query stays short */
const BRAVE_SITES = 8;

/** Brave Search: GET /res/v1/web/search ($0.005 a request); outlets as site: terms */
export const brave: SearchProvider = {
  key: "brave",
  name: "Brave Search",
  envKey: "BRAVE_SEARCH_API_KEY",
  capacity: BRAVE_SITES,
  units: { requests: 1 },
  snippets: { storable: false, copiedFromPage: false },
  async search(request, key) {
    const sites = request.domains.slice(0, BRAVE_SITES).map((d) => `site:${d}`);
    const q = sites.length ? `${request.text} (${sites.join(" OR ")})` : request.text;
    const params = new URLSearchParams({ q, count: String(Math.min(RESEARCH_CONFIG.resultsPerQuery, 20)), text_decorations: "false" });
    const body = await call(
      "brave",
      () =>
        fetchWithTimeout(
          `https://api.search.brave.com/res/v1/web/search?${params}`,
          { headers: { "X-Subscription-Token": key, Accept: "application/json", "User-Agent": enrichmentUserAgent() } },
          20_000,
        ),
      { 401: "quota", 402: "quota", 403: "quota", 429: "rate_limited" },
    );
    const parsed = braveAnswer.safeParse(body);
    if (!parsed.success) throw new SearchFailure("brave", null);
    return (parsed.data.web?.results ?? []).map((r, i) => ({ url: r.url, title: r.title ?? null, rank: i + 1, snippet: r.description ?? null }));
  },
};

export interface SessionOptions {
  conn: Db;
  cache: SourceCache;
  runId: string;
  /** Milliseconds between two calls to one provider */
  pace: number;
  main: SearchProvider;
  /** Off without its key */
  fallback: SearchProvider | null;
  keys: Partial<Record<SearchProvider["envKey"], string>>;
}

/** What one book's searches did, for the job's outcome and the run report */
export interface SearchLog {
  queries: Record<string, number>;
  cached: number;
  results: number;
}

/**
 * One run's searches. The main provider is used until it refuses or fails
 * twice in a row; then the fallback for the rest of the run. When both
 * refuse, the run stops (QuotaStop) and the job in hand is held.
 */
export function searchSession(options: SessionOptions) {
  const throttles = new Map<string, ReturnType<typeof serialThrottle>>();
  let mainOff = false;

  /** One metered search, from the cache when this query was asked before */
  async function ask(provider: SearchProvider, request: SearchRequest, job: { workId: string; jobId: string }, log: SearchLog): Promise<SearchResult[]> {
    const cacheKey = `search:${provider.key}:${createHash("sha256").update(stableStringify({ ...request, domains: request.domains.slice(0, provider.capacity) })).digest("hex")}`;
    const cached = options.cache.get(cacheKey);
    if (cached) {
      log.cached++;
      return cached.answer as SearchResult[];
    }
    const key = options.keys[provider.envKey];
    if (!key) throw new Error(`${provider.envKey} is not set`);
    // The book's ceiling: its spend this month plus this call's estimate
    const estimate = costOf(provider.units, priceFor(provider.key, "search"));
    if ((await monthSpend(options.conn, { workId: job.workId })) + estimate > RESEARCH_CONFIG.maxCostPerWork)
      throw new WorkCeilingStop(`The book's research would pass its ceiling of $${RESEARCH_CONFIG.maxCostPerWork} this month`);
    if (!throttles.has(provider.key)) throttles.set(provider.key, serialThrottle(options.pace));
    const results = await throttles.get(provider.key)!(() =>
      metered(
        { database: options.conn, provider: provider.key, operation: "search", estimate: provider.units, workId: job.workId, jobId: job.jobId, runId: options.runId },
        async () => ({ result: await provider.search(request, key), units: provider.units }),
      ),
    );
    log.queries[provider.key] = (log.queries[provider.key] ?? 0) + 1;
    log.results += results.length;
    // A snippet is kept only where the provider's terms allow storing it
    const kept = results.map((r) => ({ ...r, snippet: provider.snippets.storable ? r.snippet : null }));
    options.cache.set(cacheKey, kept);
    return kept;
  }

  /** A provider's answer, with one retry after a failure */
  async function attempt(provider: SearchProvider, request: SearchRequest, job: { workId: string; jobId: string }, log: SearchLog) {
    try {
      return await ask(provider, request, job, log);
    } catch (error) {
      if (!(error instanceof SearchFailure)) throw error;
      return ask(provider, request, job, log);
    }
  }

  return {
    get mainOff() {
      return mainOff;
    },
    /** One query: the main provider while it works, else the fallback; both refusing stops the run */
    async search(request: SearchRequest, job: { workId: string; jobId: string }, log: SearchLog, useFallback = false): Promise<{ provider: SearchProvider; results: SearchResult[] }> {
      if (!mainOff && !useFallback)
        try {
          return { provider: options.main, results: await attempt(options.main, request, job, log) };
        } catch (error) {
          if (!(error instanceof SearchRefusal || error instanceof SearchFailure)) throw error;
          mainOff = true;
          if (!options.fallback) throw stop(error);
        }
      if (!options.fallback) throw new Error("No fallback search provider: BRAVE_SEARCH_API_KEY is not set");
      try {
        return { provider: options.fallback, results: await attempt(options.fallback, request, job, log) };
      } catch (error) {
        if (error instanceof SearchRefusal || error instanceof SearchFailure) throw stop(error);
        throw error;
      }
    },
  };
}

/** Both providers refused (or the main one did, with no fallback): the run stops and the job is held */
function stop(error: SearchRefusal | SearchFailure) {
  return new QuotaStop(`Search stopped: ${error.message}`, 0, error instanceof SearchRefusal ? error.reason : "quota");
}

export type SearchSession = ReturnType<typeof searchSession>;
