import { HeadBucketCommand } from "@aws-sdk/client-s3";
import {
  GoogleBooksQuotaError,
  googleBooksFetch,
  googleBooksOverQuota,
  lastGoogleBooksCall,
} from "@/lib/api/google-books-quota";
import { count, eq, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ebookFiles, ebooks, sourceRecords } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { s3, S3_BUCKET } from "@/lib/s3/client";
import {
  EXTERNAL_TIMEOUT_MS,
  ExternalFetchError,
  fetchWithTimeout,
} from "@/lib/api/external-fetch";

/**
 * The outside services Durtal talks to, and a live check of each (Settings,
 * Integrations). Server only. A check never returns or logs a URL, header,
 * body or secret: only a status and a plain message. Checks run on demand,
 * never from /api/health, which Docker polls every 30 s.
 */

export const INTEGRATION_IDS = [
  "database",
  "storage",
  "isbndb",
  "googleBooks",
  "openLibrary",
  "googlePlaces",
  "nominatim",
  "mapbox",
  "wikidata",
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
  /** The e-book catalogue: e-books, those linked to a book, files stored, the newest */
  ebooks: { ebooks: number; linked: number; files: number; lastAdded: string | null };
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

/** The services, what each is for and how it is set up; the e-books; the tokens. */
export async function integrationsOverview(): Promise<IntegrationsOverview> {
  const [[wikidata], [books], [files]] = await Promise.all([
    db
      .select({ records: count(), last: max(sourceRecords.retrievedAt) })
      .from(sourceRecords)
      .where(eq(sourceRecords.provider, "wikidata")),
    db
      .select({ ebooks: count(), linked: count(ebooks.instanceId), last: max(ebooks.createdAt) })
      .from(ebooks),
    db.select({ files: count() }).from(ebookFiles),
  ]);
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
      purpose: "Keeps covers, photos, attachments and eBook files.",
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
  ];
  return {
    services,
    ebooks: {
      ebooks: books?.ebooks ?? 0,
      linked: books?.linked ?? 0,
      files: files?.files ?? 0,
      lastAdded: books?.last ? formatDate(books.last) : null,
    },
    access: { restToken: isSet("DURTAL_API_TOKEN"), adminToken: isSet("ADMIN_TOKEN") },
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
  statuses: Record<number, CheckResult> = {},
): Promise<CheckResult> {
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
        : `${name} could not be reached`,
    );
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
        EXTERNAL_TIMEOUT_MS,
      ),
    ),
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
        : "The database refused the connection",
    );
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
          : `The bucket is not in ${region}`,
      );
    }
    if (status === 403) return failure("The credentials cannot read this bucket");
    if (status === 404) return failure(`There is no bucket named ${S3_BUCKET}`);
    if (failed.name === "TimeoutError" || failed.name === "AbortError") {
      return failure(`S3 did not answer within ${EXTERNAL_TIMEOUT_MS / 1000} s`);
    }
    return failure("S3 could not be reached");
  }
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
      }).catch((error: unknown) =>
        error instanceof GoogleBooksQuotaError
          ? new Response(null, { status: 429 })
          : Promise.reject(error),
      ),
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
      `https://openlibrary.org/search.json?isbn=${PROBE_ISBN}&limit=1&fields=key`,
      { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
    ),
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
      { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
    ),
  );
}

const CHECKS: Record<Exclude<IntegrationId, "mapbox">, () => Promise<CheckResult>> = {
  database: checkDatabase,
  storage: checkStorage,
  isbndb: checkIsbndb,
  googleBooks: checkGoogleBooks,
  openLibrary: checkOpenLibrary,
  googlePlaces: checkGooglePlaces,
  nominatim: checkNominatim,
  wikidata: checkWikidata,
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
