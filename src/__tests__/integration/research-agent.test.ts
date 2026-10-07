import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";
import type { EvidenceObjects } from "@/lib/s3/evidence-objects";

const url = process.env.DURTAL_RESEARCH_AGENT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln469_research_agent")
    throw new Error("Research agent tests require disposable local sln469_research_agent");
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { enqueueScope, runWorker } from "@/lib/enrichment/worker";
import { researchStage } from "@/lib/enrichment/research/stage";
import { loadProfiles } from "@/lib/enrichment/research/profile";
import { SearchRefusal, type SearchProvider, type SearchRequest, type SearchResult } from "@/lib/enrichment/research/search";
import { applyOutletSeed } from "@/lib/enrichment/outlet-registry";
import { applyVocabulary } from "@/lib/enrichment/loader";
import { enqueueEnrichmentJob } from "@/lib/enrichment/jobs";
import { SourceCache } from "@/lib/enrichment/source-cache";
import { EvidenceFetchError, type FetchedPage } from "@/lib/net/safe-fetch-page";
import { vocabularySeedSchema } from "@/lib/validations/enrichment";
import { createWork } from "@/lib/actions/works";
import { createEdition } from "@/lib/actions/editions";
import type { EnrichmentStage } from "@/lib/enrichment/stages";
import type { Outlet } from "@/lib/enrichment/outlets";

/*
 * SLN-469: the research stage in the worker, on PostgreSQL. The search
 * providers, the page fetcher and the bucket are stubs; pages go through the
 * real evidence store and searches through the real cost meter. No network.
 */

const outlet = (key: string, over: Partial<Outlet> = {}): Outlet => ({
  key,
  name: key.toUpperCase(),
  domains: [`${key}.example`],
  kind: "review",
  language: "en",
  weight: 0.5,
  syndicationGroup: null,
  fetchPolicy: "fetch",
  termsUrl: null,
  termsCheckedOn: "2026-10-07",
  termsNote: null,
  status: "active",
  ...over,
});
const OUTLETS = [
  outlet("nyrb", { weight: 0.95 }),
  outlet("lrb", { weight: 0.9 }),
  outlet("elpais", { weight: 0.8, language: "es" }),
  outlet("quiet", { weight: 0.85, fetchPolicy: "snippet_only", termsCheckedOn: null }),
  outlet("closed", { weight: 0.99, fetchPolicy: "excluded", termsCheckedOn: null }),
];
const CONTACT = "durtal@example.org";

describe.skipIf(!url)("the research agent", () => {
  const c = client!;
  const conn = testDb as unknown as Db;
  const bucket: Record<string, Buffer> = {};
  const objects: EvidenceObjects = {
    putIfMissing: async (key, body) => (key in bucket ? false : ((bucket[key] = body), true)),
    get: async (key) => bucket[key] ?? null,
  };
  const extractor = { name: "test", version: "1", extract: (html: string) => ({ text: html.replace(/<[^>]+>/g, ""), title: null, byline: null, publishedOn: null, language: "en", canonicalUrl: null }) };

  /** Search stubs: each answers what its test sets, and logs what it was asked */
  const searches: { provider: string; request: SearchRequest }[] = [];
  let answers: Record<"tavily" | "brave", (request: SearchRequest) => SearchResult[]>;
  const stub = (key: "tavily" | "brave", snippets = { storable: false, copiedFromPage: false }): SearchProvider => ({
    key,
    name: key,
    envKey: key === "tavily" ? "TAVILY_API_KEY" : "BRAVE_SEARCH_API_KEY",
    capacity: key === "tavily" ? 300 : 8,
    units: key === "tavily" ? { credits: 1 } : { requests: 1 },
    snippets,
    async search(request) {
      searches.push({ provider: key, request });
      return answers[key](request);
    },
  });
  const result = (url: string, rank: number, snippet: string | null = null): SearchResult => ({ url, title: null, rank, snippet });
  const refuse = (provider: string, status: number, reason: "quota" | "rate_limited") => () => {
    throw new SearchRefusal(provider, status, reason);
  };

  /** The page fetcher: a short page per URL, or a refusal the test names */
  const fetched: string[] = [];
  let refusals: Record<string, ConstructorParameters<typeof EvidenceFetchError>[0]> = {};
  const fetchPage = async (requested: string): Promise<FetchedPage> => {
    fetched.push(requested);
    if (refusals[requested]) throw new EvidenceFetchError(refusals[requested], "refused");
    const outletKey = new URL(requested).hostname.split(".")[0];
    const html = `<p>A review of the book at ${requested}.</p>`;
    return {
      requestedUrl: requested,
      finalUrl: requested,
      httpStatus: 200,
      contentType: "text/html",
      charset: "utf-8",
      raw: Buffer.from(html),
      html,
      outlet: outletKey,
      robots: { url: `https://${outletKey}.example/robots.txt`, status: 200, group: "*", rule: null, decision: "allowed", crawlDelay: null, fetchedAt: new Date().toISOString() },
    };
  };
  let keys: Partial<Record<"TAVILY_API_KEY" | "BRAVE_SEARCH_API_KEY", string>>;
  const stage = (snippets?: { storable: boolean; copiedFromPage: boolean }) =>
    researchStage({
      main: stub("tavily", snippets),
      fallback: stub("brave"),
      keys: () => keys,
      pageFetcher: () => fetchPage,
      extractor,
      objects,
    }) as EnrichmentStage;
  const run = (options: Partial<Parameters<typeof runWorker>[1]> = {}) =>
    runWorker(conn, {
      runId: randomUUID(),
      worker: `test:${randomUUID()}`,
      kinds: ["research"],
      apply: true,
      cache: SourceCache.memory(),
      contact: CONTACT,
      // No pacing between stubbed calls
      pace: 0,
      stages: { research: stage() },
      ...options,
    });

  const book = async (title: string, fields: Record<string, unknown> = {}) => {
    const [w] = await c`insert into works ${c({ title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 6)}`, ...fields })} returning id, slug`;
    const [a] = await c`insert into authors(name, slug, last_name) values ('Curzio Malaparte', ${randomUUID()}, 'Malaparte') returning id`;
    await c`insert into work_authors(work_id, author_id, role) values (${w.id}, ${a.id}, 'author')`;
    await enqueueEnrichmentJob({ workId: w.id, kind: "research", reason: "manual" }, conn);
    return w as { id: string; slug: string };
  };
  const jobOf = async (workId: string, kind = "research") =>
    (await c`select status, attempts, held_reason, payload from enrichment_jobs where work_id = ${workId} and kind = ${kind}`)[0];
  const documents = (workId: string) =>
    c`select provider, url, payload ->> 'kind' as kind, payload ->> 'retrievedVia' as via from source_records where work_id = ${workId} order by url`;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    // The fixture vocabulary names this book as a term's example
    await c`insert into works(id, title, slug) values ('7c2f1d52-1b8e-4c5a-9d3e-2f6a8b1c4e90', 'Example', 'example-book')`;
    const seed = vocabularySeedSchema.parse(JSON.parse(readFileSync("src/__tests__/fixtures/enrichment/vocabulary.json", "utf8")));
    await testDb!.transaction((tx) => applyVocabulary(tx as unknown as Db, seed, { approvalUrl: "https://linear.app/x/approval", seedSha256: "a".repeat(64) }));
    await applyOutletSeed(conn, OUTLETS, 1);
  }, 60000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client?.end();
  });
  beforeEach(async () => {
    await c`delete from enrichment_jobs`;
    searches.length = 0;
    fetched.length = 0;
    refusals = {};
    keys = { TAVILY_API_KEY: "tavily-test", BRAVE_SEARCH_API_KEY: "brave-test" };
    vi.stubEnv("ENRICHMENT_MONTHLY_CAP_USD", "100");
    answers = { tavily: () => [], brave: () => [] };
  });

  it("plans without a search, a fetch or a write: the profile, the queries and the cost, and the table for Pablo", async () => {
    const w = await book("Kaputt");
    const snapshot = async () => [
      await c`select * from enrichment_jobs order by id`,
      await c`select * from source_records order by id`,
      await c`select * from enrichment_costs order by id`,
      await c`select id, updated_at from works order by id`,
    ];
    const before = await snapshot();
    const report = await run({ apply: false });
    expect(searches).toEqual([]);
    expect(fetched).toEqual([]);
    expect(await snapshot()).toEqual(before);
    const text = report.lines.join("\n");
    expect(text).toContain(`- ${w.slug}: `);
    expect(text).toContain('base: "Kaputt Curzio Malaparte review"');
    expect(text).toContain("## Research: the query table and the limits, for Pablo's approval");
    expect(text).toMatch(/estimate \$0\.000 \(\$0\.\d+ on the fallback\)/);
  });

  it("refuses an apply without the main search key", async () => {
    await book("No key");
    keys = {};
    await expect(run()).rejects.toThrow("Research needs TAVILY_API_KEY");
  });

  it("queues a research job for a new book, with its identity job", async () => {
    const [author] = await c`insert into authors(name, slug) values ('Marcel Schwob', ${randomUUID()}) returning id`;
    const work = await createWork({ title: "Imaginary Lives", originalLanguage: "fr", authorIds: [{ authorId: author.id }] });
    expect(await c`select kind, payload ->> 'reason' as reason from enrichment_jobs where work_id = ${work.id} order by kind`).toEqual([
      { kind: "identity", reason: "created" },
      { kind: "research", reason: "created" },
    ]);
  });

  it("stores only allowlisted pages through the evidence store, never asks for a blocked host, and queues one extract job", async () => {
    const w = await book("Kaputt");
    answers.tavily = () => [
      result("https://www.goodreads.com/book/show/1", 1),
      result("https://elsewhere.example/a", 2),
      result("https://closed.example/a", 3),
      result("https://quiet.example/a", 4, "A quiet outlet's snippet of the book."),
      result("https://lrb.example/a", 5),
      result("https://lrb.example/b", 6),
      result("https://lrb.example/c", 7),
      result("https://nyrb.example/a", 8),
    ];
    refusals["https://nyrb.example/a"] = "robots_disallowed";
    const works = await c`select * from works where id = ${w.id}`;
    const report = await run();
    expect(fetched.sort()).toEqual(["https://lrb.example/a", "https://lrb.example/b", "https://nyrb.example/a"]);
    expect(await documents(w.id)).toEqual([
      { provider: "lrb", url: "https://lrb.example/a", kind: "evidence_page", via: "fetch" },
      { provider: "lrb", url: "https://lrb.example/b", kind: "evidence_page", via: "fetch" },
    ]);
    const outcome = report.jobs[0].outcome!;
    expect(outcome).toMatchObject({ result: "researched", candidates: 4, refused: { robots_disallowed: 1, snippet_only: 1 } });
    expect(outcome.dropped).toEqual({ blocked_host: 1, off_registry: 1, outlet_excluded: 1, bad_url: 0 });
    expect(await jobOf(w.id)).toMatchObject({ status: "done" });
    // Every research dimension by name, so an open vocabulary job folds into a full extraction
    expect(await jobOf(w.id, "extract")).toMatchObject({ status: "queued", payload: { reason: "research", dimensions: ["mood", "pace", "tone"] } });
    // Every search went through the meter; the book itself is untouched
    const queries = searches.length;
    expect(await c`select provider, operation, status, count(*)::int as n from enrichment_costs where work_id = ${w.id} group by 1, 2, 3`).toEqual([
      { provider: "tavily", operation: "search", status: "settled", n: queries },
    ]);
    expect(await c`select * from works where id = ${w.id}`).toEqual(works);
    expect(report.lines).toContain("## Research: per outlet (candidates, stored, refused)");
    expect(report.lines).toContain("- lrb: 2, 2, 0");
  });

  it("moves to the fallback for the rest of the run when the main provider refuses", async () => {
    const w = await book("Fallback");
    answers.tavily = refuse("tavily", 432, "quota");
    answers.brave = () => [result("https://lrb.example/fallback", 1)];
    await run();
    expect(searches.filter((s) => s.provider === "tavily")).toHaveLength(1);
    expect(searches.filter((s) => s.provider === "brave").length).toBeGreaterThan(1);
    expect(await documents(w.id)).toEqual([{ provider: "lrb", url: "https://lrb.example/fallback", kind: "evidence_page", via: "fetch" }]);
    // Brave's site: terms take its own number of outlets
    expect(searches.find((s) => s.provider === "brave" && s.request.domains.length)!.request.domains.length).toBeGreaterThan(0);
  });

  it("asks the fallback once for a book the main provider leaves with fewer than two candidates", async () => {
    const w = await book("Too few");
    answers.tavily = () => [result("https://lrb.example/only", 1)];
    answers.brave = () => [result("https://nyrb.example/second", 1)];
    const report = await run();
    expect(report.jobs[0].outcome).toMatchObject({ fallbackForBook: true, candidates: 2 });
    expect((await documents(w.id)).map((d) => d.url)).toEqual(["https://lrb.example/only", "https://nyrb.example/second"]);
  });

  it("keeps the run going when only the fallback refuses a book's extra pass: the book keeps the main provider's pages", async () => {
    const first = await book("Lonely");
    const second = await book("Solitary");
    // One candidate per book from the main provider: each book would ask the fallback once
    answers.tavily = (request) => [result(`https://lrb.example/${request.text.split(" ")[0].toLowerCase()}`, 1)];
    answers.brave = refuse("brave", 402, "quota");
    const report = await run();
    expect(report.stopped).toBeNull();
    expect(await jobOf(first.id)).toMatchObject({ status: "done" });
    expect(await jobOf(second.id)).toMatchObject({ status: "done" });
    expect((await documents(first.id)).map((d) => d.url)).toEqual(["https://lrb.example/lonely"]);
    expect((await documents(second.id)).map((d) => d.url)).toEqual(["https://lrb.example/solitary"]);
    // The fallback is off for the rest of the run after its refusal
    expect(searches.filter((s) => s.provider === "brave")).toHaveLength(1);
  });

  it("asks the fallback for a book whose only other candidate is a snippet it may not use", async () => {
    const w = await book("Quiet");
    answers.tavily = () => [result("https://lrb.example/quiet-book", 1), result("https://quiet.example/quiet-book", 2, "A snippet.")];
    answers.brave = () => [result("https://nyrb.example/quiet-book", 1)];
    const report = await run();
    expect(report.jobs[0].outcome).toMatchObject({ fallbackForBook: true });
    expect((await documents(w.id)).map((d) => d.url)).toEqual(["https://lrb.example/quiet-book", "https://nyrb.example/quiet-book"]);
  });

  it("stops the run and holds the job without an attempt when both providers refuse; nothing of it is cached", async () => {
    const w = await book("Refused");
    answers.tavily = refuse("tavily", 429, "rate_limited");
    answers.brave = refuse("brave", 429, "rate_limited");
    const file = join(mkdtempSync(join(tmpdir(), "research-")), "cache.json");
    const report = await run({ cache: SourceCache.load(file) });
    expect(report.lines[0]).toMatch(/^Stopped after 0 of 1 jobs: Search stopped: brave refused a search \(HTTP 429\)/);
    expect(await jobOf(w.id)).toMatchObject({ status: "held", held_reason: "rate_limited", attempts: 0 });
    expect(() => readFileSync(file, "utf8")).toThrow();
    // Without a fallback key, the main provider's refusal stops the run too
    keys = { TAVILY_API_KEY: "tavily-test" };
    await c`update enrichment_jobs set status = 'queued', held_reason = null where work_id = ${w.id}`;
    answers.tavily = refuse("tavily", 432, "quota");
    await run();
    expect(await jobOf(w.id)).toMatchObject({ status: "held", held_reason: "quota", attempts: 0 });
  });

  it("holds the job for the budget without an attempt, and for the book's ceiling until it is named", async () => {
    const w = await book("Budget");
    answers.tavily = () => [result("https://lrb.example/budget", 1)];
    vi.stubEnv("ENRICHMENT_MONTHLY_CAP_USD", "");
    const stopped = await run();
    expect(stopped.lines[0]).toMatch(/^Stopped after 0 of 1 jobs: Stopped: monthly budget reached/);
    expect(await jobOf(w.id)).toMatchObject({ status: "held", held_reason: "budget", attempts: 0 });

    // The book has spent its ceiling this month: Brave's search would pass it
    vi.stubEnv("ENRICHMENT_MONTHLY_CAP_USD", "10");
    const pricey = await book("Ceiling");
    await c`insert into enrichment_costs ${c({
      provider: "brave",
      operation: "search",
      status: "settled",
      estimated_units: JSON.stringify({ requests: 1 }),
      units: JSON.stringify({ requests: 1 }),
      estimated_cost_usd: 1.499,
      cost_usd: 1.499,
      price_version: "test",
      work_id: pricey.id,
      settled_at: new Date().toISOString(),
    })}`;
    keys = { TAVILY_API_KEY: "tavily-test", BRAVE_SEARCH_API_KEY: "brave-test" };
    answers.tavily = refuse("tavily", 429, "rate_limited");
    answers.brave = () => [result("https://lrb.example/ceiling", 1)];
    await run({ only: [pricey.slug] });
    expect(await jobOf(pricey.id)).toMatchObject({ status: "held", held_reason: "work_cost_ceiling", attempts: 0 });
    // A run that does not name the book leaves it held
    searches.length = 0;
    await run();
    expect(await jobOf(pricey.id)).toMatchObject({ status: "held", held_reason: "work_cost_ceiling" });
  });

  it("stores a snippet only when the provider's terms allow it and it is the page's own text, under the outlet's key", async () => {
    const w = await book("Snippet");
    answers.tavily = () => [result("https://quiet.example/snippet", 1, "A quiet outlet's snippet of the book.")];
    await run({ stages: { research: stage({ storable: true, copiedFromPage: true }) } });
    expect(await documents(w.id)).toEqual([{ provider: "quiet", url: "https://quiet.example/snippet", kind: "evidence_text", via: "search:tavily" }]);
    expect(fetched).toEqual([]);
    const [payload] = await c`select payload ->> 'query' as query from source_records where work_id = ${w.id}`;
    expect(payload.query).toBe("Snippet Curzio Malaparte review");
  });

  it("sends no note, rating, description or reading to a search provider", async () => {
    const w = await book("Private", { notes: "SECRET NOTE", description: "SECRET DESCRIPTION", rating: 4.5 });
    answers.tavily = () => [];
    await run();
    expect(searches.length).toBeGreaterThan(0);
    expect(JSON.stringify(searches)).not.toMatch(/SECRET|4\.5/);
    const { profiles } = await loadProfiles(conn, [w.id]);
    expect(JSON.stringify(profiles)).not.toMatch(/SECRET|4\.5/);
  });

  it("queues every book of a scope but the researched ones; --only names one again", async () => {
    const fresh = await book("Fresh");
    const done = await book("Researched");
    await c`update enrichment_jobs set status = 'done', finished_at = now() where work_id = ${done.id}`;
    await c`delete from enrichment_jobs where work_id = ${fresh.id}`;
    const all = await enqueueScope(conn, { kind: "research", scope: "all", apply: false });
    const named = await enqueueScope(conn, { kind: "research", scope: "all", only: [done.slug], apply: false });
    expect(named.books).toBe(1);
    await enqueueScope(conn, { kind: "research", scope: "all", only: [fresh.slug, done.slug], apply: true });
    expect(await c`select count(*)::int as n from enrichment_jobs where work_id in (${fresh.id}, ${done.id}) and status = 'queued'`).toEqual([{ n: 2 }]);
    expect(all.books).toBe((await c`select count(*)::int as n from works w where w.kind = 'book'
      and not exists (select 1 from enrichment_jobs j where j.work_id = w.id and j.kind = 'research' and j.status = 'done')`)[0].n);
  });

  it("researches a book skipped for having no author once it has one (SLN-530)", async () => {
    const [w] = await c`insert into works ${c({ title: "Anonymous", slug: `anonymous-${randomUUID().slice(0, 6)}` })} returning id, slug`;
    await enqueueEnrichmentJob({ workId: w.id, kind: "research", reason: "manual" }, conn);
    await run();
    expect(searches).toEqual([]);
    expect(await c`select status, payload -> 'outcome' as outcome from enrichment_jobs where work_id = ${w.id}`).toEqual([
      { status: "done", outcome: { result: "skipped", reason: "the book has no author" } },
    ]);
    const [a] = await c`insert into authors(name, slug) values ('Gaspard de la Nuit', ${randomUUID()}) returning id`;
    await c`insert into work_authors(work_id, author_id, role) values (${w.id}, ${a.id}, 'author')`;
    await enqueueScope(conn, { kind: "research", scope: "all", apply: true });
    expect(await c`select status from enrichment_jobs where work_id = ${w.id} order by created_at`).toEqual([{ status: "done" }, { status: "queued" }]);
    await run({ only: [w.slug] });
    expect(searches.length).toBeGreaterThan(0);
    // Researched now: the next scope run leaves it out
    await c`delete from enrichment_jobs where status = 'queued'`;
    await enqueueScope(conn, { kind: "research", scope: "all", apply: true });
    expect(await c`select payload -> 'outcome' ->> 'result' as result from enrichment_jobs where work_id = ${w.id} order by created_at`).toEqual([
      { result: "skipped" },
      { result: "researched" },
    ]);
  });

  it("queues only identity when a researched book gets a new edition; a book skipped for no author queues research (SLN-530)", async () => {
    const researched = await book("Kaputt");
    await run();
    expect((await jobOf(researched.id)).payload.outcome.result).toBe("researched");
    await createEdition({ workId: researched.id, title: "Kaputt", isbn13: "9780000000002" });
    expect(await c`select kind, status from enrichment_jobs where work_id = ${researched.id} and kind <> 'extract' order by kind`).toEqual([
      { kind: "identity", status: "queued" },
      { kind: "research", status: "done" },
    ]);

    const skipped = await book("The Skin");
    await c`update enrichment_jobs set status = 'done', finished_at = now(),
      payload = payload || '{"outcome": {"result": "skipped", "reason": "the book has no author"}}'::jsonb where work_id = ${skipped.id}`;
    await createEdition({ workId: skipped.id, title: "The Skin", isbn13: "9780000000019" });
    expect(await c`select kind, status from enrichment_jobs where work_id = ${skipped.id} order by kind, created_at`).toEqual([
      { kind: "identity", status: "queued" },
      { kind: "research", status: "done" },
      { kind: "research", status: "queued" },
    ]);
  });
});
