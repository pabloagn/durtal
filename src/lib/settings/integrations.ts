import { HeadBucketCommand } from "@aws-sdk/client-s3";
import {
  GoogleBooksQuotaError,
  googleBooksFetch,
  googleBooksOverQuota,
  lastGoogleBooksCall } from "@/lib/api/google-books-quota";
import { and, count, eq, inArray, max, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ebookFiles, ebookIngestRuns, ebooks, enrichmentCosts, evidenceOutlets, sourceRecords } from "@/lib/db/schema";
import { enrichmentSpend, evidenceCacheStats } from "@/lib/settings/data";
import { createPageFetcher } from "@/lib/net/safe-fetch-page";
import { outletForUrl } from "@/lib/enrichment/outlets";
import { loadOutlets } from "@/lib/enrichment/outlet-registry";
import { BudgetStop, metered, monthlyCapUsd } from "@/lib/enrichment/meter";
import { enrichmentUserAgent } from "@/lib/enrichment/user-agent";
import { anthropicClient } from "@/lib/enrichment/research/model";
import { EXTRACTION_MODEL } from "@/lib/enrichment/research/config";
import { serverEnv } from "@/lib/env";
import { s3, S3_BUCKET } from "@/lib/s3/client";
import { previewS3Dir } from "@/lib/s3/preview-dir";
import { ebookS3, ebookStorage, headEbookObject } from "@/lib/ebooks/storage";
import { readNewestCatalogueCover, readNewestDeliverableFile } from "@/lib/ebooks/delivery/files";
import { coverUrlFor, ebookDelivery, fileUrlFor } from "@/lib/ebooks/delivery/url";
import {
  EXTERNAL_TIMEOUT_MS,
  ExternalFetchError,
  fetchWithTimeout } from "@/lib/api/external-fetch";

/**
 * The outside services Durtal talks to, and a live check of each (Settings,
 * Integrations). Server only. A check never returns or logs a URL, header,
 * body or secret: only a status and a plain message. Checks run on demand,
 * never from /api/health, which Docker polls every 30 s.
 */

export const INTEGRATION_IDS = [
  "database",
  "storage",
  "ebookStorage",
  "isbndb",
  "googleBooks",
  "openLibrary",
  "googlePlaces",
  "nominatim",
  "mapbox",
  "wikidata",
  "evidenceFetcher",
  "enrichmentBudget",
  "tavily",
  "braveSearch",
  "extractionModel",
] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

/** ok: works; warning: works with a problem; error: does not work; off: not set up */
export type CheckStatus = "ok" | "warning" | "error" | "off";
export interface CheckResult {
  status: CheckStatus;
  message: string;
}

export interface IntegrationInfo {
  id: IntegrationId;
  name: string;
  purpose: string;
  /** The environment variables it reads: names and whether each is set, never values */
  env: { name: string; set: boolean; optional?: boolean }[];
  /** Mapbox runs in the browser, so the browser checks it */
  checkFrom: "server" | "browser";
  facts: { label: string; value: string }[];
}

export interface IntegrationsOverview {
  services: IntegrationInfo[];
  /** The e-book catalogue: e-books, those linked to a book, files stored, the newest, ingestion runs */
  ebooks: { ebooks: number; linked: number; files: number; lastAdded: string | null; runs: number };
  /** Whether the REST write routes and the media maintenance routes ask for a token */
  access: { restToken: boolean; adminToken: boolean };
}

/** A published book that every book source holds: the checks ask for it. */
const PROBE_ISBN = "9780857865618";
const USER_AGENT = "Durtal/1.0 (personal book catalogue)";
const isSet = (name: string) => Boolean(process.env[name]?.trim());

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);

const usd = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

/** The services, what each is for and how it is set up; the e-books; the tokens. */
export async function integrationsOverview(): Promise<IntegrationsOverview> {
  const [[wikidata], [books], [files], [runs], policies, evidence, spend, searches] = await Promise.all([
    db
      .select({ records: count(), last: max(sourceRecords.retrievedAt) })
      .from(sourceRecords)
      .where(eq(sourceRecords.provider, "wikidata")),
    db
      .select({ ebooks: count(), linked: count(ebooks.instanceId), last: max(ebooks.createdAt) })
      .from(ebooks),
    db.select({ files: count() }).from(ebookFiles),
    db.select({ runs: count() }).from(ebookIngestRuns),
    db
      .select({ policy: evidenceOutlets.fetchPolicy, outlets: count() })
      .from(evidenceOutlets)
      .where(eq(evidenceOutlets.status, "active"))
      .groupBy(evidenceOutlets.fetchPolicy),
    evidenceCacheStats(),
    enrichmentSpend(),
    // The research agent's searches and model calls, from the cost ledger
    db
      .select({ provider: enrichmentCosts.provider, calls: count(), last: max(enrichmentCosts.createdAt) })
      .from(enrichmentCosts)
      // Settled calls of the agent's own work: a check is not a use
      .where(
        and(
          inArray(enrichmentCosts.provider, ["tavily", "brave", EXTRACTION_MODEL.provider]),
          eq(enrichmentCosts.status, "settled"),
          ne(enrichmentCosts.operation, "check")))
      .groupBy(enrichmentCosts.provider),
  ]);
  const lastUsed = (provider: string) => {
    const row = searches.find((s) => s.provider === provider);
    return row?.last ? `${formatDate(row.last)} (${row.calls} calls)` : "Never";
  };
  const outlets = (policy: string) => policies.find((p) => p.policy === policy)?.outlets ?? 0;
  const services: IntegrationInfo[] = [
    {
      id: "database",
      name: "Neon Postgres",
      purpose: "Holds the catalogue.",
      env: [{ name: "DATABASE_URL", set: isSet("DATABASE_URL") }],
      checkFrom: "server",
      facts: [],
    },
    {
      id: "storage",
      name: "Amazon S3",
      purpose: "Keeps covers, photos and attachments.",
      env: [
        { name: "AWS_ACCESS_KEY_ID", set: isSet("AWS_ACCESS_KEY_ID") },
        { name: "AWS_SECRET_ACCESS_KEY", set: isSet("AWS_SECRET_ACCESS_KEY") },
        { name: "AWS_REGION", set: isSet("AWS_REGION"), optional: true },
        { name: "S3_BUCKET", set: isSet("S3_BUCKET"), optional: true },
      ],
      checkFrom: "server",
      facts: [
        { label: "Bucket", value: S3_BUCKET },
        { label: "Region", value: process.env.AWS_REGION ?? "us-east-1 (default)" },
      ],
    },
    ebookStorageInfo(),
    {
      id: "isbndb",
      name: "ISBNdb",
      purpose: "First source for book search, Identify and Match. Each check uses one call of the plan.",
      env: [{ name: "ISBNDB_API_KEY", set: Boolean(serverEnv().ISBNDB_API_KEY) }],
      checkFrom: "server",
      facts: [],
    },
    {
      id: "googleBooks",
      name: "Google Books",
      purpose: "Second source for book search and Match. Without a key it uses the shared quota.",
      env: [{ name: "GOOGLE_BOOKS_API_KEY", set: isSet("GOOGLE_BOOKS_API_KEY"), optional: true }],
      checkFrom: "server",
      facts: [{ label: "Last search call", value: lastGoogleBooksCallText() }],
    },
    {
      id: "openLibrary",
      name: "Open Library",
      purpose: "Third source for book search and Match, and covers. No key needed.",
      env: [],
      checkFrom: "server",
      facts: [],
    },
    {
      id: "googlePlaces",
      name: "Google Places",
      purpose: "Search when you add a place.",
      env: [{ name: "GOOGLE_PLACES_API_KEY", set: isSet("GOOGLE_PLACES_API_KEY") }],
      checkFrom: "server",
      facts: [],
    },
    {
      id: "nominatim",
      name: "OpenStreetMap Nominatim",
      purpose: "Addresses and map pins for locations. No key needed.",
      env: [],
      checkFrom: "server",
      facts: [],
    },
    {
      id: "mapbox",
      name: "Mapbox",
      purpose: "The People map. The token is built into the app: a new token needs a new build.",
      env: [{ name: "NEXT_PUBLIC_MAPBOX_TOKEN", set: isSet("NEXT_PUBLIC_MAPBOX_TOKEN") }],
      checkFrom: "browser",
      facts: [],
    },
    {
      id: "wikidata",
      name: "Wikidata",
      purpose: "Facts about people and publishers, read by the enrichment scripts. No key needed.",
      env: [],
      checkFrom: "server",
      facts: [
        {
          label: "Last used",
          value: wikidata?.last
            ? `${formatDate(wikidata.last)} (${wikidata.records} records)`
            : "Never",
        },
      ],
    },
    {
      id: "evidenceFetcher",
      name: "Evidence fetcher",
      purpose: "Fetches review and publisher pages of the outlet registry for the book enrichment, politely, and keeps a private copy to check quotes.",
      env: [{ name: "ENRICHMENT_CONTACT", set: isSet("ENRICHMENT_CONTACT") }],
      checkFrom: "server",
      facts: [
        { label: "Active outlets", value: `${outlets("fetch")} fetched, ${outlets("snippet_only")} snippets only, ${outlets("excluded")} excluded` },
        { label: "Documents stored", value: evidence.documents.toLocaleString("en-GB") },
        { label: "Last fetch", value: evidence.lastFetch ? formatDate(evidence.lastFetch) : "Never" },
      ],
    },
    {
      id: "enrichmentBudget",
      name: "Enrichment budget",
      purpose: "The monthly cap on paid search and model calls. Every metered call reserves its cost first and stops at the cap.",
      env: [{ name: "ENRICHMENT_MONTHLY_CAP_USD", set: isSet("ENRICHMENT_MONTHLY_CAP_USD") }],
      checkFrom: "server",
      facts: [
        { label: "Spent this month", value: usd(spend.spent) },
        { label: "Open reservations", value: `${spend.openReservations} (${usd(spend.reserved)})` },
        { label: "Cap", value: spend.cap === null ? "Not set" : usd(spend.cap) },
        { label: "Last paid call", value: spend.lastPaidAt ? formatDate(spend.lastPaidAt) : "Never" },
      ],
    },
    {
      id: "tavily",
      name: "Tavily",
      purpose: "The research agent's main search: it finds review and publisher pages of the outlet registry for the book enrichment. The free plan gives 1,000 searches a month.",
      env: [{ name: "TAVILY_API_KEY", set: isSet("TAVILY_API_KEY") }],
      checkFrom: "server",
      facts: [
        { label: "Role", value: "Main search" },
        { label: "Last used", value: lastUsed("tavily") },
      ],
    },
    {
      id: "braveSearch",
      name: "Brave Search",
      purpose: "The research agent's fallback search, when Tavily refuses or finds too little. $5 per 1,000 searches; each check spends one, through the budget.",
      env: [{ name: "BRAVE_SEARCH_API_KEY", set: isSet("BRAVE_SEARCH_API_KEY"), optional: true }],
      checkFrom: "server",
      facts: [
        { label: "Role", value: "Fallback search" },
        { label: "Last used", value: lastUsed("brave") },
      ],
    },
    {
      id: "extractionModel",
      name: "Anthropic",
      purpose: "The research agent's extraction model: it reads the passages about a book and returns vocabulary terms with exact quotes. About $0.50 a book, through the budget; the check is free.",
      env: [{ name: "ANTHROPIC_API_KEY", set: isSet("ANTHROPIC_API_KEY") }],
      checkFrom: "server",
      facts: [
        { label: "Role", value: "Extraction model" },
        { label: "Model", value: EXTRACTION_MODEL.model },
        { label: "Last used", value: lastUsed(EXTRACTION_MODEL.provider) },
      ],
    },
  ];
  return {
    services,
    ebooks: {
      ebooks: books?.ebooks ?? 0,
      linked: books?.linked ?? 0,
      files: files?.files ?? 0,
      lastAdded: books?.last ? formatDate(books.last) : null,
      runs: runs?.runs ?? 0,
    },
    access: { restToken: isSet("DURTAL_API_TOKEN"), adminToken: isSet("ADMIN_TOKEN") },
  };
}

/** The e-book bucket and how files reach the browser (SLN-491) */
function ebookStorageInfo(): IntegrationInfo {
  const { bucket, prefix, region } = ebookStorage();
  const cloudfront = ebookDelivery() === "cloudfront";
  return {
    id: "ebookStorage",
    name: "eBook storage",
    purpose: cloudfront
      ? "Keeps validated eBook files in gold/ebooks/ in the private bucket. CloudFront sends them to the browser by signed URLs that last at least 6 hours."
      : "Keeps validated eBook files in gold/ebooks/ in the private bucket. The app sends them to the browser itself; CloudFront is not set up.",
    env: [
      { name: "EBOOKS_BUCKET", set: isSet("EBOOKS_BUCKET"), optional: true },
      { name: "EBOOKS_PREFIX", set: isSet("EBOOKS_PREFIX"), optional: true },
      { name: "EBOOKS_REGION", set: isSet("EBOOKS_REGION"), optional: true },
      { name: "EBOOK_DELIVERY", set: isSet("EBOOK_DELIVERY"), optional: true },
      { name: "EBOOK_CDN_URL", set: isSet("EBOOK_CDN_URL"), optional: !cloudfront },
      { name: "EBOOK_CDN_KEY_PAIR_ID", set: isSet("EBOOK_CDN_KEY_PAIR_ID"), optional: !cloudfront },
      { name: "EBOOK_CDN_PRIVATE_KEY", set: isSet("EBOOK_CDN_PRIVATE_KEY"), optional: !cloudfront },
    ],
    checkFrom: "server",
    facts: [
      { label: "Bucket", value: prefix ? `${bucket}; legacy prefix ${prefix}` : bucket },
      { label: "Region", value: region },
      { label: "Delivery", value: cloudfront ? "CloudFront, signed URLs" : "The app" },
    ],
  };
}

// ── Checks ──────────────────────────────────────────────────────────────────

const ok = (message: string): CheckResult => ({ status: "ok", message });
const warning = (message: string): CheckResult => ({ status: "warning", message });
const failure = (message: string): CheckResult => ({ status: "error", message });
const off = (message: string): CheckResult => ({ status: "off", message });

/** Milliseconds since `start`, rounded */
const since = (start: number) => Math.round(performance.now() - start);

/** The answer of an HTTP service as a check: a message for each status */
async function httpCheck(
  name: string,
  request: () => Promise<Response>,
  statuses: Record<number, CheckResult> = {}): Promise<CheckResult> {
  const start = performance.now();
  let res: Response;
  try {
    res = await request();
  } catch (error) {
    // A plain fetch's time limit aborts with a TimeoutError
    const timedOut =
      (error instanceof ExternalFetchError && error.timedOut) ||
      (error instanceof Error && error.name === "TimeoutError");
    return failure(
      timedOut
        ? `${name} did not answer within ${EXTERNAL_TIMEOUT_MS / 1000} s`
        : `${name} could not be reached`);
  }
  // Read the answer, so the connection is freed; its content is not used
  await res.arrayBuffer().catch(() => undefined);
  if (res.ok) return ok(`Answered in ${since(start)} ms`);
  return statuses[res.status] ?? failure(`${name} answered with status ${res.status}`);
}

/** Reject after the time limit: for clients without their own (the database) */
function withinLimit<T>(work: Promise<T>, name: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${name} did not answer within ${EXTERNAL_TIMEOUT_MS / 1000} s`)),
        EXTERNAL_TIMEOUT_MS)),
  ]);
}

async function checkDatabase(): Promise<CheckResult> {
  if (!isSet("DATABASE_URL")) return off("DATABASE_URL is not set");
  const start = performance.now();
  try {
    await withinLimit(db.execute(sql`select 1`), "The database");
    return ok(`Answered in ${since(start)} ms`);
  } catch (error) {
    return failure(
      error instanceof Error && /did not answer/.test(error.message)
        ? error.message
        : "The database refused the connection");
  }
}

async function checkStorage(): Promise<CheckResult> {
  if (!isSet("AWS_ACCESS_KEY_ID") || !isSet("AWS_SECRET_ACCESS_KEY")) {
    return off("The access keys are not set");
  }
  const region = serverEnv().AWS_REGION;
  const start = performance.now();
  try {
    const answer = await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }), {
      abortSignal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });
    if (answer.BucketRegion && answer.BucketRegion !== region) {
      return warning(`The bucket is in ${answer.BucketRegion}, but AWS_REGION is ${region}`);
    }
    return ok(`Answered in ${since(start)} ms`);
  } catch (error) {
    const failed = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
      $response?: { headers?: Record<string, string> };
    };
    const status = failed.$metadata?.httpStatusCode;
    const actual = failed.$response?.headers?.["x-amz-bucket-region"];
    if (status === 301 || actual) {
      return failure(
        actual
          ? `The bucket is in ${actual}, but AWS_REGION is ${region}`
          : `The bucket is not in ${region}`);
    }
    if (status === 403) return failure("The credentials cannot read this bucket");
    if (status === 404) return failure(`There is no bucket named ${S3_BUCKET}`);
    if (failed.name === "TimeoutError" || failed.name === "AbortError") {
      return failure(`S3 did not answer within ${EXTERNAL_TIMEOUT_MS / 1000} s`);
    }
    return failure("S3 could not be reached");
  }
}

/**
 * The e-book bucket: a HEAD of the newest stored file (or of the bucket,
 * before any file is stored), and with CloudFront the first byte of one
 * signed derived object (a cover, else the file itself).
 */
async function checkEbookStorage(): Promise<CheckResult> {
  if (previewS3Dir()) return ok("This preview keeps eBook files in a local folder");
  if (!isSet("AWS_ACCESS_KEY_ID") || !isSet("AWS_SECRET_ACCESS_KEY")) {
    return off("The access keys are not set");
  }
  const { bucket, region } = ebookStorage();
  const start = performance.now();
  let file: Awaited<ReturnType<typeof readNewestDeliverableFile>>;
  try {
    file = await withinLimit(readNewestDeliverableFile(), "The database");
    if (!file) {
      try {
        await ebookS3().send(new HeadBucketCommand({ Bucket: bucket }), {
          abortSignal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
        });
      } catch (error) {
        // Before the AWS setup there is neither a bucket nor a file: not set up, not broken
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
          return off("Not set up yet: no eBook bucket and no eBook file (scripts/aws/ebooks-storage.sh plan)");
        }
        throw error;
      }
      return ok(`The bucket answered in ${since(start)} ms; no eBook file is stored yet`);
    }
    if (!(await withinLimit(headEbookObject(file.s3Key), "S3"))) {
      return failure("The newest eBook file is not in the bucket");
    }
  } catch (error) {
    const failed = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const status = failed.$metadata?.httpStatusCode;
    if (status === 301) return failure(`The bucket is not in ${region}`);
    if (status === 403) return failure("The credentials cannot read the eBook bucket");
    if (status === 404) return failure(`There is no bucket named ${bucket}`);
    if (/did not answer/.test(failed.message ?? "")) return failure(failed.message!);
    if (failed.name === "TimeoutError" || failed.name === "AbortError") {
      return failure(`S3 did not answer within ${EXTERNAL_TIMEOUT_MS / 1000} s`);
    }
    return failure("S3 could not be reached");
  }
  const s3Time = since(start);
  if (ebookDelivery() !== "cloudfront") return ok(`S3 answered in ${s3Time} ms; the app sends the files`);
  const cover = await readNewestCatalogueCover();
  const target = (cover && coverUrlFor(cover, 240)) ?? fileUrlFor(file);
  const edge = performance.now();
  let res: Response;
  try {
    res = await fetchWithTimeout(target.url, { headers: { Range: "bytes=0-0" } });
  } catch {
    return failure(`S3 answered in ${s3Time} ms, but CloudFront could not be reached`);
  }
  await res.arrayBuffer().catch(() => undefined);
  if (res.status === 206 || res.status === 200) {
    return ok(`S3 answered in ${s3Time} ms and CloudFront in ${since(edge)} ms`);
  }
  if (res.status === 403) return failure("CloudFront refused the signed URL: check the key pair id and the key group");
  return failure(`CloudFront answered with status ${res.status}`);
}

/** The last Google Books call from search or Match, since the app started */
function lastGoogleBooksCallText() {
  const call = lastGoogleBooksCall();
  if (!call) return "None since the app started";
  const at = `${call.at.toISOString().slice(11, 16)} UTC`;
  if (call.outcome === "ok") return `Worked at ${at}`;
  if (call.outcome === "quota")
    return googleBooksOverQuota()
      ? `Over the quota at ${at}; paused before the next try`
      : `Over the quota at ${at}`;
  return call.status ? `Failed at ${at} (HTTP ${call.status})` : `Failed at ${at}`;
}

function checkIsbndb(): Promise<CheckResult> {
  const key = serverEnv().ISBNDB_API_KEY?.trim();
  if (!key) return Promise.resolve(off("ISBNDB_API_KEY is not set"));
  return httpCheck(
    "ISBNdb",
    () =>
      fetchWithTimeout(`https://api2.isbndb.com/book/${PROBE_ISBN}`, {
        headers: { Authorization: key },
        cache: "no-store",
      }),
    {
      401: failure("ISBNdb refused the key"),
      403: failure("ISBNdb refused the key"),
      404: warning("ISBNdb answered, but it no longer has the test book"),
      429: warning("Over the plan's rate or daily limit"),
    },
  );
}

async function checkGoogleBooks(): Promise<CheckResult> {
  const key = serverEnv().GOOGLE_BOOKS_API_KEY?.trim();
  const params = new URLSearchParams({ q: `isbn:${PROBE_ISBN}`, maxResults: "1" });
  if (key) params.set("key", key);
  const result = await httpCheck(
    "Google Books",
    // Through the quota state: no call while it pauses, and the check counts
    // as the last call. A refusal reads as the 429 it was.
    () =>
      googleBooksFetch(`https://www.googleapis.com/books/v1/volumes?${params}`, {
        cache: "no-store",
      }).catch((error: unknown) => (error instanceof GoogleBooksQuotaError
          ? new Response(null, { status: 429 })
          : Promise.reject(error))),
    {
      400: failure("Google Books refused the key"),
      403: warning("Over the quota, or the Books API is off for this key"),
      429: warning("Over the quota"),
    },
  );
  return result.status === "ok" && !key
    ? ok(`${result.message}, without a key (shared quota)`)
    : result;
}

function checkOpenLibrary(): Promise<CheckResult> {
  return httpCheck("Open Library", () =>
    fetchWithTimeout(
      `https://openlibrary.org/search.json?isbn=${PROBE_ISBN}&limit=1&fields=key`, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" }),
  );
}

function checkGooglePlaces(): Promise<CheckResult> {
  const key = serverEnv().GOOGLE_PLACES_API_KEY?.trim();
  if (!key) return Promise.resolve(off("GOOGLE_PLACES_API_KEY is not set"));
  return httpCheck(
    "Google Places",
    () =>
      fetchWithTimeout("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          // Place ids only: the cheapest answer
          "X-Goog-FieldMask": "places.id",
        },
        body: JSON.stringify({ textQuery: "Shakespeare and Company Paris", maxResultCount: 1 }),
        cache: "no-store",
      }),
    {
      400: failure("Google Places refused the key"),
      403: failure("Google Places refused the key, or the API is off for it"),
      429: warning("Over the quota"),
    },
  );
}

function checkNominatim(): Promise<CheckResult> {
  return httpCheck("Nominatim", () =>
    fetchWithTimeout("https://nominatim.openstreetmap.org/status?format=json", {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
    }),
  );
}

function checkWikidata(): Promise<CheckResult> {
  return httpCheck("Wikidata", () =>
    fetchWithTimeout(
      "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q42&props=info&format=json",
      { headers: { "User-Agent": USER_AGENT }, cache: "no-store" }),
  );
}

/** The robots.txt of the first active outlet that may be fetched, through the evidence fetcher */
async function checkEvidenceFetcher(): Promise<CheckResult> {
  if (!isSet("ENRICHMENT_CONTACT")) return off("ENRICHMENT_CONTACT is not set");
  const outlets = await loadOutlets();
  const first = outlets.find((o) => o.status === "active" && o.fetchPolicy === "fetch");
  if (!first) return warning("No outlet may be fetched yet");
  const fetcher = createPageFetcher({ outletFor: (url) => outletForUrl(url, outlets) });
  const start = performance.now();
  const robots = await fetcher.readRobots(`https://${first.domains[0]}/`);
  if (!robots.readable) return failure(`The robots.txt of ${first.name} could not be read`);
  return ok(`Read the robots.txt of ${first.name} in ${since(start)} ms (HTTP ${robots.status})`);
}

/** The ledger against the cap, without a call */
async function checkEnrichmentBudget(): Promise<CheckResult> {
  const spend = await enrichmentSpend();
  if (spend.cap === null) return off("ENRICHMENT_MONTHLY_CAP_USD is not set: every metered call stops");
  const used = spend.spent + spend.reserved;
  if (spend.cap === 0) return ok("Cap of $0: free-tier calls only");
  const text = `${usd(used)} of ${usd(spend.cap)} this month`;
  if (used >= spend.cap) return failure(`At the cap: ${text}`);
  if (used >= spend.cap * 0.8) return warning(`Over 80% of the cap: ${text}`);
  return ok(text);
}

/** The enrichment User-Agent, when its contact is set */
const enrichmentHeaders = (): Record<string, string> => (isSet("ENRICHMENT_CONTACT") ? { "User-Agent": enrichmentUserAgent() } : {});

/** The key's usage, a free call */
function checkTavily(): Promise<CheckResult> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return Promise.resolve(off("TAVILY_API_KEY is not set"));
  return httpCheck(
    "Tavily",
    () => fetchWithTimeout("https://api.tavily.com/usage", { headers: { Authorization: `Bearer ${key}`, ...enrichmentHeaders() }, cache: "no-store" }),
    {
      401: failure("Tavily refused the key"),
      429: warning("Over the rate limit of the usage call; try again in a few minutes"),
      432: warning("Over the plan's credits for this month"),
    });
}

/** A check answer that was not billed: a refusal, or no answer */
class UnbilledCheck extends Error {
  readonly billed = false;
  constructor(readonly result: CheckResult) {
    super(result.message);
  }
}

/** Brave has no free call that proves a key: one search, through the budget; at the cap, no call */
async function checkBraveSearch(): Promise<CheckResult> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) return off("BRAVE_SEARCH_API_KEY is not set: the fallback is off");
  if (monthlyCapUsd() === null) return warning("ENRICHMENT_MONTHLY_CAP_USD is not set: no check call was made");
  try {
    return await metered({ provider: "brave", operation: "check", estimate: { requests: 1 } }, async () => {
      const result = await httpCheck(
        "Brave Search",
        () =>
          fetchWithTimeout("https://api.search.brave.com/res/v1/web/search?q=Huysmans&count=1", {
            headers: { "X-Subscription-Token": key, Accept: "application/json", ...enrichmentHeaders() },
            cache: "no-store",
          }),
        {
          401: failure("Brave Search refused the key"),
          402: warning("Brave Search asks for payment details on this key"),
          403: failure("Brave Search refused the key"),
          429: warning("Over the plan's rate or quota"),
        },
      );
      // Only an answered search is billed: a refusal or no answer releases the reservation
      if (result.status !== "ok") throw new UnbilledCheck(result);
      return { result, units: { requests: 1 } };
    });
  } catch (error) {
    if (error instanceof UnbilledCheck) return error.result;
    if (error instanceof BudgetStop) return warning("At the budget cap: no check call was made");
    throw error;
  }
}

/** The pinned model's record, a free call */
async function checkExtractionModel(): Promise<CheckResult> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return off("ANTHROPIC_API_KEY is not set: extraction refuses to apply");
  const start = performance.now();
  try {
    await anthropicClient(key, EXTERNAL_TIMEOUT_MS).models.retrieve(EXTRACTION_MODEL.model);
    return ok(`The key can use ${EXTRACTION_MODEL.model} (${since(start)} ms)`);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) return failure("Anthropic refused the key");
    if (status === 404) return failure(`The key cannot use ${EXTRACTION_MODEL.model}`);
    if (status === 429) return warning("Over the rate limit; try again in a few minutes");
    return failure("Anthropic could not be reached");
  }
}

const CHECKS: Record<Exclude<IntegrationId, "mapbox">, () => Promise<CheckResult>> = {
  database: checkDatabase,
  storage: checkStorage,
  ebookStorage: checkEbookStorage,
  isbndb: checkIsbndb,
  googleBooks: checkGoogleBooks,
  openLibrary: checkOpenLibrary,
  googlePlaces: checkGooglePlaces,
  nominatim: checkNominatim,
  wikidata: checkWikidata,
  evidenceFetcher: checkEvidenceFetcher,
  enrichmentBudget: checkEnrichmentBudget,
  tavily: checkTavily,
  braveSearch: checkBraveSearch,
  extractionModel: checkExtractionModel,
};

/** A live check of one service. Mapbox is checked by the browser. */
export async function runIntegrationCheck(id: IntegrationId): Promise<CheckResult> {
  if (id === "mapbox") return off("The browser checks Mapbox");
  try {
    return await CHECKS[id]();
  } catch {
    return failure("The check failed");
  }
}
