import { sql } from "drizzle-orm";
import { resultRows } from "@/lib/harmonization/store";
import type { Db } from "@/lib/catalogue/work-store";
import { bucketEvidenceObjects, type EvidenceObjects } from "@/lib/s3/evidence-objects";
import { createPageFetcher, EvidenceFetchError, type FetchedPage } from "@/lib/net/safe-fetch-page";
import { enqueueEnrichmentJob } from "../jobs";
import { loadOutlets } from "../outlet-registry";
import { outletForUrl, type Outlet } from "../outlets";
import { mainTextExtractor } from "../extract";
import { storeEvidencePage, storeEvidenceText, type MainTextExtractor } from "../evidence-store";
import { costOf, priceFor } from "../prices";
import { monthlyCapUsd, monthSpend } from "../meter";
import type { EnrichmentStage, StageContext, StageJob } from "../stages";
import { RESEARCH_CONFIG, REVIEW_WORDS, TOPIC_WORDS } from "./config";
import { loadProfiles, researchDimensions, type ResearchProfile } from "./profile";
import { planQueries, type ResearchQuery } from "./queries";
import { rankCandidates } from "./rank";
import { brave, searchSession, tavily, type SearchLog, type SearchProvider, type SearchResult, type SearchSession } from "./search";

/*
 * The research stage (SLN-469, section 2): for each queued book, the
 * queries of its profile, the searches, the allowlisted candidates, and the
 * pages stored through the evidence store (SLN-468), which is the fetch. It
 * writes no claim. A plan makes no search, no fetch and no write; it shows
 * the profile, the queries, the documents already stored and the cost. A
 * finished job queues the book's extract job (SLN-469's second PR works it).
 */

const usd = (amount: number) => `$${amount.toFixed(amount < 1 ? 3 : 2)}`;

export interface ResearchPlan {
  profile: ResearchProfile | null;
  /** Why the book is not researched */
  skipped: string | null;
  queries: ResearchQuery[];
  withoutTopic: string[];
  /** Documents the book already has */
  stored: number;
  /** The searches' cost at the main provider's price; the fallback's when every query went there */
  estimate: { main: number; fallback: number };
  /** What the apply did */
  log?: ResearchLog;
}

export interface ResearchLog extends SearchLog {
  fallbackForBook: boolean;
  candidates: number;
  dropped: Record<string, number>;
  documents: { outlet: string; url: string; fetched: boolean }[];
  refused: Record<string, number>;
  outlets: Record<string, { candidates: number; stored: number; refused: number }>;
  spend: number;
}

/** What the stage calls; tests pass stubs */
export interface ResearchDeps {
  main: SearchProvider;
  fallback: SearchProvider;
  keys: () => Partial<Record<SearchProvider["envKey"], string>>;
  pageFetcher: (outlets: readonly Outlet[]) => (url: string) => Promise<FetchedPage>;
  extractor: MainTextExtractor;
  objects: EvidenceObjects;
  storePage: typeof storeEvidencePage;
  storeText: typeof storeEvidenceText;
}

const DEFAULTS: ResearchDeps = {
  main: tavily,
  fallback: brave,
  keys: () => ({ TAVILY_API_KEY: process.env.TAVILY_API_KEY?.trim() || undefined, BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY?.trim() || undefined }),
  pageFetcher: (outlets) => createPageFetcher({ outletFor: (url) => outletForUrl(url, outlets) }).fetchPage,
  extractor: mainTextExtractor,
  objects: bucketEvidenceObjects,
  storePage: storeEvidencePage,
  storeText: storeEvidenceText,
};

/** The documents a book already has: its evidence pages and texts */
async function storedDocuments(conn: Db, workId: string) {
  const [row] = resultRows<{ n: number }>(
    await conn.execute(sql`select count(*)::int as n from source_records
      where work_id = ${workId}::uuid and payload ->> 'kind' in ('evidence_page', 'evidence_text')`),
  );
  return row.n;
}

const searchCost = (provider: SearchProvider) => costOf(provider.units, priceFor(provider.key, "search"));

export function researchStage(overrides: Partial<ResearchDeps> = {}): EnrichmentStage<ResearchPlan> {
  const deps = { ...DEFAULTS, ...overrides };
  // One search session and one page fetcher per run: a provider that refused stays off for the run
  const runs = new Map<string, { session: SearchSession; fetchPage: (url: string) => Promise<FetchedPage>; outlets: Outlet[] }>();
  async function runState(conn: Db, ctx: StageContext) {
    let state = runs.get(ctx.runId);
    if (!state) {
      const keys = deps.keys();
      const outlets = await loadOutlets(conn);
      state = {
        outlets,
        fetchPage: deps.pageFetcher(outlets),
        session: searchSession({
          conn,
          cache: ctx.cache,
          runId: ctx.runId,
          pace: ctx.pace,
          main: deps.main,
          fallback: keys[deps.fallback.envKey] ? deps.fallback : null,
          keys,
        }),
      };
      runs.set(ctx.runId, state);
    }
    return state;
  }

  return {
    kind: "research",
    callsOut: true,

    preflight() {
      if (!deps.keys()[deps.main.envKey]) throw new Error(`Research needs ${deps.main.envKey}: set it in .env.local (docs/13_CONFIGURATION.md)`);
      if (deps.extractor.name === "pending")
        throw new Error("Research waits for the main-text extractor: its packages (readability and linkedom) wait for Pablo's yes");
    },

    // Searches are paid: they run per job in `work`, an apply only
    async fetch() {},

    async plan(conn, job) {
      const { profiles, skipped } = await loadProfiles(conn, [job.workId]);
      const profile = profiles[0] ?? null;
      const empty = { queries: [], withoutTopic: [], stored: 0, estimate: { main: 0, fallback: 0 } };
      if (!profile) {
        const plan: ResearchPlan = { profile: null, skipped: skipped[0]?.reason ?? "not a book", ...empty };
        return { plan, summary: `skipped: ${plan.skipped}` };
      }
      const { queries, withoutTopic } = planQueries(profile, await researchDimensions(conn), await loadOutlets(conn), deps.main.capacity);
      const plan: ResearchPlan = {
        profile,
        skipped: null,
        queries,
        withoutTopic,
        stored: await storedDocuments(conn, job.workId),
        estimate: { main: queries.length * searchCost(deps.main), fallback: queries.length * searchCost(deps.fallback) },
      };
      const translators = profile.translators.map((t) => t.name).join(", ");
      const summary = [
        `${queries.length} queries, ${plan.stored} documents stored, estimate ${usd(plan.estimate.main)} (${usd(plan.estimate.fallback)} on the fallback)`,
        `    profile: ${profile.titles.map((t) => `"${t}"`).join(", ")} by ${profile.authors.map((a) => a.name).join(", ")}${translators ? `, translated by ${translators}` : ""}; original language ${profile.originalLanguage ?? "unknown"}`,
        ...queries.map((q) => `    ${q.group}: "${q.text}"${q.outlets.length ? ` [${q.outlets.length} outlets: ${q.outlets.slice(0, 5).join(", ")}${q.outlets.length > 5 ? ", …" : ""}]` : ""}${q.dimensions.length ? ` (${q.dimensions.join(", ")})` : ""}`),
        ...(withoutTopic.length ? [`    no topic words for ${withoutTopic.join(", ")}`] : []),
      ].join("\n");
      return { plan, summary };
    },

    async work(conn, job: StageJob, plan, ctx) {
      if (!ctx.apply) throw new Error("A plan makes no search and no fetch");
      if (!plan.profile) return plan;
      const { session, fetchPage, outlets } = await runState(conn, ctx);
      const byKey = new Map(outlets.map((o) => [o.key, o]));
      const spentBefore = await monthSpend(conn, { workId: job.workId });
      const log: ResearchLog = {
        queries: {},
        cached: 0,
        results: 0,
        fallbackForBook: false,
        candidates: 0,
        dropped: {},
        documents: [],
        refused: {},
        outlets: {},
        spend: 0,
      };
      const ids = { workId: job.workId, jobId: job.id };
      const searchAll = async (useFallback: boolean) => {
        const found: { query: string; provider: string; result: SearchResult }[] = [];
        for (const q of plan.queries) {
          const domains = q.outlets.flatMap((key) => byKey.get(key)?.domains ?? []);
          const { provider, results } = await session.search({ text: q.text, domains }, ids, log, useFallback);
          for (const result of results) found.push({ query: q.text, provider: provider.key, result });
        }
        return found;
      };

      let found = await searchAll(false);
      let ranking = rankCandidates(found, outlets);
      // Too few allowlisted candidates from the main provider: the fallback once, with the same queries
      if (!session.mainOff && ranking.candidates.length < 2 && deps.keys()[deps.fallback.envKey]) {
        log.fallbackForBook = true;
        found = [...found, ...(await searchAll(true))];
        ranking = rankCandidates(found, outlets);
      }
      log.candidates = ranking.candidates.length;
      log.dropped = ranking.dropped;

      const owner = { kind: "book" as const, workId: job.workId };
      const outletLog = (key: string) => (log.outlets[key] ??= { candidates: 0, stored: 0, refused: 0 });
      for (const c of ranking.candidates) outletLog(c.outlet.key).candidates++;
      for (const c of ranking.candidates) {
        if (log.documents.length >= RESEARCH_CONFIG.maxDocumentsPerWork) break;
        if (c.outlet.fetchPolicy === "snippet_only") {
          // Never fetched; its snippet only where the provider's terms allow storing it and it is the page's own text
          const provider = [deps.main, deps.fallback].find((p) => p.key === c.provider)!;
          if (!(provider.snippets.storable && provider.snippets.copiedFromPage && c.snippet?.trim())) {
            log.refused.snippet_only = (log.refused.snippet_only ?? 0) + 1;
            outletLog(c.outlet.key).refused++;
            continue;
          }
          await deps.storeText({
            database: conn,
            owner,
            outlet: c.outlet.key,
            outletName: c.outlet.name,
            url: c.url,
            text: c.snippet,
            searchProvider: provider.key,
            query: c.query,
            runId: ctx.runId,
            jobId: job.id,
            objects: deps.objects,
          });
          log.documents.push({ outlet: c.outlet.key, url: c.url, fetched: false });
          outletLog(c.outlet.key).stored++;
          continue;
        }
        try {
          const stored = await deps.storePage({
            database: conn,
            owner,
            url: c.url,
            runId: ctx.runId,
            jobId: job.id,
            fetchPage,
            extractor: deps.extractor,
            objects: deps.objects,
            outletName: (key) => byKey.get(key)?.name ?? key,
          });
          log.documents.push({ outlet: c.outlet.key, url: stored.record.url ?? c.url, fetched: stored.fetched });
          outletLog(c.outlet.key).stored++;
        } catch (error) {
          // A refusal (robots.txt, terms, paywall, 404, too large): the next candidate
          if (!(error instanceof EvidenceFetchError)) throw error;
          log.refused[error.reason] = (log.refused[error.reason] ?? 0) + 1;
          outletLog(c.outlet.key).refused++;
        }
      }
      log.spend = (await monthSpend(conn, { workId: job.workId })) - spentBefore;
      return { ...plan, log };
    },

    async write(tx, job, plan) {
      if (!plan.profile) return { result: "skipped", reason: plan.skipped };
      await enqueueEnrichmentJob({ workId: job.workId, kind: "extract", reason: "research", priority: job.priority }, tx);
      return { result: "researched", ...plan.log! };
    },

    steps: [],

    async undo() {
      return ["Research: its documents and cost rows stay; they record calls that were made and paid"];
    },

    summarize(plans) {
      const books = plans.filter((p) => p.profile);
      const total = (pick: (p: ResearchPlan) => number) => books.reduce((sum, p) => sum + pick(p), 0);
      const fallbackOn = Boolean(deps.keys()[deps.fallback.envKey]);
      return [
        `## Research: ${books.length} books, ${plans.length - books.length} skipped`,
        `- Queries: ${total((p) => p.queries.length)}; estimate ${usd(total((p) => p.estimate.main))} on ${deps.main.name}${fallbackOn ? `, ${usd(total((p) => p.estimate.fallback))} if all went to ${deps.fallback.name}` : `; the fallback (${deps.fallback.name}) is off: ${deps.fallback.envKey} is not set`}`,
        `- Monthly cap: ${monthlyCapUsd() === null ? "not set (every metered call stops)" : usd(monthlyCapUsd()!)}; ceiling per book ${usd(RESEARCH_CONFIG.maxCostPerWork)}`,
        "## Research: the query table and the limits, for Pablo's approval",
        `- Limits: ${RESEARCH_CONFIG.maxBaseQueries} base queries, ${RESEARCH_CONFIG.maxOutletQueries} outlet queries, ${RESEARCH_CONFIG.maxTopicQueries} topic queries, ${RESEARCH_CONFIG.resultsPerQuery} results each; ${RESEARCH_CONFIG.maxPerOutlet} documents per outlet and ${RESEARCH_CONFIG.maxDocumentsPerWork} per book`,
        `- The word for "review": ${Object.entries(REVIEW_WORDS).map(([language, word]) => `${language} ${word}`).join(", ")}`,
        `- Topic words: ${Object.entries(TOPIC_WORDS).map(([dimension, words]) => `${dimension} "${words}"`).join(", ")}`,
      ];
    },

    outcomes(outcomes) {
      const researched = outcomes.filter((o) => o.result === "researched") as unknown as (ResearchLog & { refused: Record<string, number> })[];
      const sum = (pick: (o: ResearchLog) => number) => researched.reduce((total, o) => total + pick(o), 0);
      const merged = (pick: (o: ResearchLog) => Record<string, number>) => {
        const out: Record<string, number> = {};
        for (const o of researched) for (const [k, n] of Object.entries(pick(o))) out[k] = (out[k] ?? 0) + n;
        return Object.entries(out).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
      };
      const outlets = new Map<string, { candidates: number; stored: number; refused: number }>();
      for (const o of researched)
        for (const [key, n] of Object.entries(o.outlets)) {
          const row = outlets.get(key) ?? { candidates: 0, stored: 0, refused: 0 };
          outlets.set(key, { candidates: row.candidates + n.candidates, stored: row.stored + n.stored, refused: row.refused + n.refused });
        }
      const spend = sum((o) => o.spend);
      return [
        `## Research: what the run did (${researched.length} books)`,
        `- Queries by provider: ${merged((o) => o.queries)}; answered from the cache: ${sum((o) => o.cached)}; the fallback for too few candidates: ${researched.filter((o) => o.fallbackForBook).length} books`,
        `- Results ${sum((o) => o.results)}; allowlisted candidates ${sum((o) => o.candidates)}; dropped: ${merged((o) => o.dropped)}`,
        `- Documents stored ${sum((o) => o.documents.length)} (${sum((o) => o.documents.filter((d) => d.fetched).length)} fetched); refused: ${merged((o) => o.refused)}`,
        `- Spend on search ${usd(spend)}, ${usd(researched.length ? spend / researched.length : 0)} a book`,
        "## Research: per outlet (candidates, stored, refused)",
        ...[...outlets].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => `- ${key}: ${n.candidates}, ${n.stored}, ${n.refused}`),
      ];
    },
  };
}
