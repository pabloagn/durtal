/**
 * The Wikidata Action API (www.wikidata.org/w/api.php), shared by the
 * publisher and author enrichments. The Action API stays up when the query
 * service is rate-limited. Calls go one at a time, a little apart, with a
 * time limit; a 429 waits as long as Wikidata asks, and lagging servers
 * (maxlag) are waited for. Callers keep every answer in a cache they save,
 * so a dry run and the apply that follows read the same answers.
 */
import {
  ExternalFetchError,
  fetchWithTimeout,
  serialThrottle,
} from "@/lib/api/external-fetch";

const API = "https://www.wikidata.org/w/api.php";
const HEADERS = {
  "User-Agent": "Durtal personal catalogue (Wikidata enrichment)",
  Accept: "application/json",
};
// One call every two seconds unless a script sets another pace
let polite = serialThrottle(2000);

/** The gap between two calls; one second is the least this client allows */
export function setWikidataPace(gapMs: number) {
  polite = serialThrottle(Math.max(1000, gapMs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function wikidataApi(params: Record<string, string>): Promise<any> {
  return polite(async () => {
    const url = `${API}?${new URLSearchParams({ ...params, format: "json", maxlag: "15" })}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetchWithTimeout(url, { headers: HEADERS }, 20000);
      if (res.status === 429 && attempt < 8) {
        const wait = (Number(res.headers.get("retry-after")) || 30) + 1;
        console.error(`[wikidata] 429 on ${params.action}${params.generator ? `/${params.generator}` : ""}: waiting ${wait} s`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!res.ok)
        throw new ExternalFetchError(`www.wikidata.org answered ${res.status}`, res.status);
      const data = await res.json();
      // maxlag: the servers are behind; wait, then try again
      if (data?.error?.code === "maxlag" && attempt < 40) {
        console.error("[wikidata] servers lagging: waiting 30 s");
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
      if (data?.error) throw new Error(`Wikidata: ${data.error.info ?? data.error.code}`);
      return data;
    }
  });
}

export interface SearchHit {
  id: string;
  label: string | null;
  description: string | null;
  /** The label or alias the text matched */
  matched?: string | null;
}

/** Items whose English label or alias starts with the text */
export async function searchItems(
  text: string,
  cache: { search: Record<string, SearchHit[]> },
  limit = 10,
): Promise<SearchHit[]> {
  const key = text.trim().toLowerCase();
  if (cache.search[key]) return cache.search[key];
  const data = await wikidataApi({
    action: "wbsearchentities",
    search: text,
    language: "en",
    uselang: "en",
    type: "item",
    limit: String(limit),
  });
  const hits: SearchHit[] = (data.search ?? []).map(
    (r: { id: string; label?: string; description?: string; match?: { text?: string } }) => ({
      id: r.id,
      label: r.label ?? null,
      description: r.description ?? null,
      matched: r.match?.text ?? null,
    }),
  );
  cache.search[key] = hits;
  return hits;
}

/**
 * Full-text search restricted by statements, for example
 * `"Robert Stone" haswbstatement:P31=Q5` (humans named Robert Stone).
 * Answers are item ids with English labels and aliases, best match first.
 */
export interface TermHit {
  id: string;
  label: string | null;
  aliases: string[];
}

export async function searchTerms(
  query: string,
  cache: Record<string, TermHit[]>,
  limit = 20,
): Promise<TermHit[]> {
  if (cache[query]) return cache[query];
  const data = await wikidataApi({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "0",
    gsrlimit: String(limit),
    prop: "entityterms",
    wbetterms: "label|alias",
    wbetlanguage: "en",
  });
  const pages = Object.values(
    (data.query?.pages ?? {}) as Record<
      string,
      { title: string; index?: number; entityterms?: { label?: string[]; alias?: string[] } }
    >,
  ).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const hits = pages.map((p) => ({
    id: p.title,
    label: p.entityterms?.label?.[0] ?? null,
    aliases: p.entityterms?.alias ?? [],
  }));
  cache[query] = hits;
  return hits;
}

// ── Reading statements ──────────────────────────────────────────────────────

export type Statement = {
  mainsnak?: { snaktype?: string; datavalue?: { value?: unknown } };
  rank?: string;
  qualifiers?: Record<string, { datavalue?: { value?: unknown } }[]>;
};
export type Claims = Record<string, Statement[]> | undefined;

/**
 * The statements Wikidata itself ranks best: the preferred ones when there
 * are any, otherwise the normal ones. Deprecated statements are wrong by
 * Wikidata's own account and are never read.
 */
export function bestStatements(claims: Claims, property: string): Statement[] {
  const all = (claims?.[property] ?? []).filter(
    (s) => s.rank !== "deprecated" && s.mainsnak?.datavalue?.value !== undefined,
  );
  const preferred = all.filter((s) => s.rank === "preferred");
  return preferred.length ? preferred : all;
}

/** Statements without an end time (P582), when some have none */
export function currentStatements(statements: Statement[]): Statement[] {
  const open = statements.filter((s) => !s.qualifiers?.P582?.length);
  return open.length ? open : statements;
}

export const statementId = (s: Statement) =>
  (s.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id ?? null;

export function statementIds(statements: Statement[]): string[] {
  return [...new Set(statements.map(statementId).filter((v): v is string => !!v))];
}

export function statementStrings(statements: Statement[]): string[] {
  return [
    ...new Set(
      statements
        .map((s) => s.mainsnak?.datavalue?.value)
        .filter((v): v is string => typeof v === "string"),
    ),
  ];
}

export const qualifierIds = (s: Statement, property: string) =>
  (s.qualifiers?.[property] ?? [])
    .map((q) => (q.datavalue?.value as { id?: string } | undefined)?.id)
    .filter((v): v is string => !!v);

// ── Batched services ────────────────────────────────────────────────────────

/** Waits as long as a 429 asks, then tries again (up to 8 times) */
async function patientFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithTimeout(url, { ...init, headers: { ...HEADERS, ...init.headers } }, 120000);
    if (res.status === 429 && attempt < 8) {
      const wait = (Number(res.headers.get("retry-after")) || 60) + 1;
      console.error(`[wikidata] 429 on ${label}: waiting ${wait} s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new ExternalFetchError(`${label} answered ${res.status}`, res.status);
    return res;
  }
}

export interface ReconcileHit {
  id: string;
  name: string;
  description: string | null;
  score: number;
}

const RECONCILE = "https://wikidata-reconciliation.wmcloud.org/en/api";
// The reconciliation service (built for OpenRefine) answers many names per call
const reconcilePace = serialThrottle(2000);

/**
 * Wikidata items of one type for many names, 20 names per call: the
 * reconciliation service searches labels and aliases and scores each hit.
 */
export async function reconcileNames(
  names: string[],
  type: string,
  cache: Record<string, ReconcileHit[]>,
  limit = 15,
): Promise<void> {
  const missing = [...new Set(names)].filter((n) => !cache[n]);
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const queries = Object.fromEntries(batch.map((n, j) => [`q${j}`, { query: n, type, limit }]));
    const data = await reconcilePace(async () => {
      const res = await patientFetch(
        RECONCILE,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ queries: JSON.stringify(queries) }).toString(),
        },
        "the reconciliation service",
      );
      return res.json();
    });
    batch.forEach((n, j) => {
      cache[n] = ((data?.[`q${j}`]?.result ?? []) as {
        id: string;
        name: string;
        description?: string;
        score: number;
      }[]).map((r) => ({ id: r.id, name: r.name, description: r.description ?? null, score: r.score }));
    });
  }
}

const SPARQL = "https://query.wikidata.org/sparql";
// The query service allows about one query a minute
const sparqlPace = serialThrottle(61000);

/** Rows of a SPARQL SELECT, as plain values */
export async function sparqlSelect(query: string): Promise<Record<string, string>[]> {
  const data = await sparqlPace(async () => {
    const res = await patientFetch(
      SPARQL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/sparql-results+json",
        },
        body: new URLSearchParams({ query }).toString(),
      },
      "the query service",
    );
    return res.json();
  });
  return ((data?.results?.bindings ?? []) as Record<string, { value: string }>[]).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value])),
  );
}
