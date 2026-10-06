import type { IncomingHttpHeaders } from "node:http";
import { isBlockedAddress } from "@/lib/net/ip-policy";
import { guardedFetch, SafeFetchError, type HopResult } from "@/lib/net/safe-fetch";
import { robotsDecision, robotsFromAnswer, type RobotsRules } from "@/lib/net/robots";
import { serialThrottle } from "@/lib/api/external-fetch";
import { enrichmentUserAgent, ROBOTS_PRODUCT_TOKEN } from "@/lib/enrichment/user-agent";

/**
 * The evidence fetcher (SLN-468): a review or publisher page from an outlet
 * of the registry, politely. It shares the guarded loop of `safeFetchImage`
 * and adds, on every hop: blocked hosts, the outlet registry and the host's
 * robots.txt. One request at a time per host, at least 5 s apart (or the
 * host's Crawl-delay). Never a cookie, a login, a paywall bypass, an archive
 * copy or another User-Agent. Server only.
 */

/** Never fetched, whatever the registry holds (R10) */
const BLOCKED_HOSTS = ["goodreads.com", "thestorygraph.com"];
const ACCEPTED_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];
const MAX_CRAWL_DELAY_S = 60;
const MAX_RETRY_AFTER_S = 120;
/** robots.txt is cached this long at most (RFC 9309) */
const ROBOTS_TTL_MS = 24 * 3600_000;

export const EVIDENCE_FETCH_REASONS = [
  "blocked_host",
  "off_registry",
  "outlet_excluded",
  "snippet_only",
  "robots_disallowed",
  "robots_unreachable",
  "crawl_delay_too_long",
  "paywall_or_login",
  "bad_status",
  "unsupported_type",
  "too_large",
  "timeout",
  "blocked_url",
  "blocked_address",
  "too_many_redirects",
  "network",
  "no_main_text",
] as const;
export type EvidenceFetchReason = (typeof EVIDENCE_FETCH_REASONS)[number];

/** A refusal, with its typed reason for the run report */
export class EvidenceFetchError extends Error {
  constructor(
    public readonly reason: EvidenceFetchReason,
    message: string,
  ) {
    super(message);
    this.name = "EvidenceFetchError";
  }
}

/** An outlet as the fetcher needs it */
export interface OutletPolicy {
  key: string;
  fetchPolicy: "fetch" | "snippet_only" | "excluded";
}

/** The robots.txt decision stored with each document */
export interface RobotsRecord {
  url: string;
  /** The HTTP status of robots.txt; null when it could not be read */
  status: number | null;
  group: RobotsRules["group"];
  rule: string | null;
  decision: "allowed";
  crawlDelay: number | null;
  fetchedAt: string;
}

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  charset: string;
  raw: Buffer;
  /** The page decoded with `charset` */
  html: string;
  outlet: string;
  robots: RobotsRecord;
}

export interface PageFetcherOptions {
  /** The active outlet whose domain matches the URL, or null */
  outletFor: (url: URL) => OutletPolicy | null;
  /** Test only: plain http:// */
  allowHttp?: boolean;
  /** Test only: the address policy */
  isBlockedAddress?: (address: string) => boolean;
  /** The least gap between two requests to one host (default 5 s) */
  minGapMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

interface CachedRobots {
  at: number;
  status: number | null;
  url: string;
  rules: RobotsRules | "unreachable";
}
// Per process: robots.txt for 24 hours, and one pacing queue per host
const robotsCache = new Map<string, CachedRobots>();
const hostQueues = new Map<string, ReturnType<typeof serialThrottle>>();

export function isBlockedHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return BLOCKED_HOSTS.some((blocked) => name === blocked || name.endsWith(`.${blocked}`));
}

/** Seconds to wait from a Retry-After header (seconds or an HTTP date); null when absent */
function retryAfterSeconds(headers: IncomingHttpHeaders): number | null {
  const value = headers["retry-after"];
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** The charset of a page: Content-Type, then <meta charset>, else UTF-8 */
function decodePage(raw: Buffer, contentType: string | undefined): { charset: string; html: string } {
  const declared =
    /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(raw.subarray(0, 2048).toString("latin1"))?.[1];
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(declared ?? "utf-8");
  } catch {
    // An unknown label: UTF-8
    decoder = new TextDecoder("utf-8");
  }
  return { charset: decoder.encoding, html: decoder.decode(raw) };
}

/**
 * A fetcher for one run. A host that refuses twice, or asks for a wait over
 * 120 s, is skipped for the rest of the run. Without ENRICHMENT_CONTACT it
 * refuses to start.
 */
export function createPageFetcher(options: PageFetcherOptions) {
  const userAgent = enrichmentUserAgent();
  const {
    outletFor,
    allowHttp = false,
    isBlockedAddress: blocked = isBlockedAddress,
    minGapMs = 5000,
    timeoutMs = 30_000,
    maxBytes = 5 * 1024 * 1024,
    maxRedirects = 5,
  } = options;
  const skippedHosts = new Map<string, string>();

  /** robots.txt of an origin, read once; it skips the registry and robots checks and may redirect to another host */
  async function robotsFor(origin: string): Promise<CachedRobots> {
    const cached = robotsCache.get(origin);
    if (cached && Date.now() - cached.at < ROBOTS_TTL_MS) return cached;
    const url = `${origin}/robots.txt`;
    let entry: CachedRobots;
    try {
      const answer = await guardedFetch(url, {
        allowHttp,
        isBlockedAddress: blocked,
        timeoutMs,
        maxRedirects: 5,
        maxBytes: 2 * 1024 * 1024,
        headers: { "User-Agent": userAgent, Accept: "text/plain" },
        noun: "robots.txt",
        readBody: (status) => status >= 200 && status < 300,
      });
      entry = {
        at: Date.now(),
        status: answer.status,
        url,
        rules: robotsFromAnswer(answer.status, answer.body?.toString("utf8") ?? null, ROBOTS_PRODUCT_TOKEN),
      };
    } catch {
      entry = { at: Date.now(), status: null, url, rules: "unreachable" };
    }
    robotsCache.set(origin, entry);
    if (entry.rules !== "unreachable" && !hostQueues.has(origin)) {
      const queue = serialThrottle(Math.max(minGapMs, (entry.rules.crawlDelay ?? 0) * 1000));
      // The robots.txt request counts as the host's first request
      void queue(async () => undefined);
      hostQueues.set(origin, queue);
    }
    return entry;
  }

  /** The robots.txt of a URL's host and its decision for the URL: the settings check and the CLI's plan read it */
  async function readRobots(url: string) {
    const target = new URL(url);
    const entry = await robotsFor(target.origin);
    if (entry.rules === "unreachable") return { status: entry.status, readable: false as const };
    return { status: entry.status, readable: true as const, crawlDelay: entry.rules.crawlDelay, ...robotsDecision(entry.rules, target.pathname + target.search) };
  }

  return { fetchPage, readRobots };

  async function fetchPage(requestedUrl: string): Promise<FetchedPage> {
    let robots: RobotsRecord | null = null;
    let outlet: OutletPolicy | null = null;
    let answer;
    try {
      if (URL.canParse(requestedUrl) && isBlockedHost(new URL(requestedUrl).hostname))
        throw new EvidenceFetchError("blocked_host", "Goodreads and StoryGraph are never fetched");
      answer = await guardedFetch(requestedUrl, {
        allowHttp,
        isBlockedAddress: blocked,
        timeoutMs,
        maxRedirects,
        maxBytes,
        headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
        noun: "Page",
        readBody: (status, headers) =>
          status >= 200 && status < 300 && ACCEPTED_TYPES.includes((headers["content-type"] ?? "").split(";")[0].trim().toLowerCase()),
        beforeHop: async (url) => {
          if (isBlockedHost(url.hostname)) throw new EvidenceFetchError("blocked_host", "Goodreads and StoryGraph are never fetched");
          const skipped = skippedHosts.get(url.origin);
          if (skipped) throw new EvidenceFetchError("bad_status", `${url.hostname} is skipped for this run: ${skipped}`);
          outlet = outletFor(url);
          if (!outlet) throw new EvidenceFetchError("off_registry", `${url.hostname} is not an outlet of the registry`);
          if (outlet.fetchPolicy === "excluded") throw new EvidenceFetchError("outlet_excluded", `The outlet ${outlet.key} is excluded`);
          if (outlet.fetchPolicy === "snippet_only") throw new EvidenceFetchError("snippet_only", `The outlet ${outlet.key} keeps search snippets only`);
          const entry = await robotsFor(url.origin);
          if (entry.rules === "unreachable") throw new EvidenceFetchError("robots_unreachable", `The robots.txt of ${url.hostname} could not be read`);
          if ((entry.rules.crawlDelay ?? 0) > MAX_CRAWL_DELAY_S)
            throw new EvidenceFetchError("crawl_delay_too_long", `${url.hostname} asks for ${entry.rules.crawlDelay} s between requests`);
          const decision = robotsDecision(entry.rules, url.pathname + url.search);
          if (!decision.allowed) throw new EvidenceFetchError("robots_disallowed", `robots.txt of ${url.hostname} disallows this page (${decision.rule})`);
          robots = {
            url: entry.url,
            status: entry.status,
            group: entry.rules.group,
            rule: decision.rule,
            decision: "allowed",
            crawlDelay: entry.rules.crawlDelay,
            fetchedAt: new Date(entry.at).toISOString(),
          };
        },
        sendHop: (url, send) => politely(url, send),
      });
    } catch (error) {
      if (error instanceof SafeFetchError) throw new EvidenceFetchError(error.code === "not_image" ? "unsupported_type" : error.code, error.message);
      throw error;
    }
    const status = answer.status;
    if (status === 401 || status === 402 || status === 403)
      throw new EvidenceFetchError("paywall_or_login", `The page answered ${status}: behind a login or a paywall`);
    if (status < 200 || status >= 300) throw new EvidenceFetchError("bad_status", `The page answered ${status}`);
    if (!answer.body) throw new EvidenceFetchError("unsupported_type", "The page is not HTML or plain text");
    const contentType = (answer.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    return {
      requestedUrl,
      finalUrl: answer.url.toString(),
      httpStatus: status,
      contentType,
      ...decodePage(answer.body, answer.headers["content-type"]),
      raw: answer.body,
      outlet: (outlet as OutletPolicy | null)!.key,
      robots: robots!,
    };
  }

  /**
   * One hop on its host's queue. A 429 or 503 with a Retry-After of at most
   * 120 s waits once; a longer wait or a second refusal skips the host. Another
   * 5xx or a network error is tried once more after the gap.
   */
  async function politely(url: URL, send: () => Promise<HopResult>): Promise<HopResult> {
    const queue = hostQueues.get(url.origin)!;
    let waited = false;
    let retried = false;
    for (;;) {
      let result: HopResult;
      try {
        result = await queue(send);
      } catch (error) {
        if (error instanceof SafeFetchError && error.code === "network" && !retried) {
          retried = true;
          continue;
        }
        throw error;
      }
      if (!("answer" in result)) return result;
      const { status, headers } = result.answer;
      if (status === 429 || status === 503) {
        const wait = retryAfterSeconds(headers);
        if (!waited && wait !== null && wait <= MAX_RETRY_AFTER_S) {
          waited = true;
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
        skippedHosts.set(url.origin, `it answered ${status}`);
        throw new EvidenceFetchError("bad_status", `${url.hostname} answered ${status}; skipped for this run`);
      }
      if (status >= 500 && !retried) {
        retried = true;
        continue;
      }
      return result;
    }
  }
}
