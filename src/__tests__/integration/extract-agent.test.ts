import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";
import type { EvidenceObjects } from "@/lib/s3/evidence-objects";

const url = process.env.DURTAL_EXTRACT_AGENT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln469_extract_agent")
    throw new Error("Extract agent tests require disposable local sln469_extract_agent");
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
import { runWorker, undoRun } from "@/lib/enrichment/worker";
import { determinismCheck, extractStage } from "@/lib/enrichment/research/extract-stage";
import { countReviewsFound } from "@/lib/enrichment/research/documents";
import { EXTRACTOR_VERSION, type ExtractionRequest } from "@/lib/enrichment/research/request";
import type { ExtractionModel, ModelAnswer } from "@/lib/enrichment/research/model";
import { applyOutletSeed } from "@/lib/enrichment/outlet-registry";
import { applyVocabulary } from "@/lib/enrichment/loader";
import { enqueueEnrichmentJob } from "@/lib/enrichment/jobs";
import { storeEvidenceText } from "@/lib/enrichment/evidence-store";
import { SourceCache } from "@/lib/enrichment/source-cache";
import { vocabularySeedSchema } from "@/lib/validations/enrichment";
import { GOLD_SET_WORK_IDS } from "@/lib/enrichment/gold-set";
import type { EnrichmentStage } from "@/lib/enrichment/stages";
import type { Outlet } from "@/lib/enrichment/outlets";
import { runIntegrationCheck } from "@/lib/settings/integrations";

/*
 * SLN-469: the extract stage in the worker, on PostgreSQL. The model and the
 * bucket are stubs; documents go through the real evidence store, calls
 * through the real cost meter and proposals through the real claim guards.
 * No network.
 */

const outlet = (key: string, over: Partial<Outlet> = {}): Outlet => ({
  key,
  name: key.toUpperCase(),
  domains: [`${key}.example`],
  kind: "review",
  language: "en",
  weight: 0.9,
  syndicationGroup: null,
  fetchPolicy: "fetch",
  termsUrl: null,
  termsCheckedOn: "2026-10-07",
  termsNote: null,
  status: "active",
  ...over,
});
const OUTLETS = [
  outlet("nyrb", { weight: 1 }),
  outlet("lrb", { weight: 1 }),
  outlet("guardian", { weight: 1, syndicationGroup: "gnm" }),
  outlet("observer", { weight: 1, syndicationGroup: "gnm" }),
  outlet("press", { kind: "publisher", weight: 0.5 }),
];
const CONTACT = "durtal@example.org";
const APPROVAL = "https://linear.app/x/approval";

/** A review that names the book: its sentences are the excerpts the model stub returns */
const review = (sentence: string) => `In Kaputt, Curzio Malaparte reports from the eastern front. ${sentence} The book ends in Naples.`;
const DARK = "It is a dark book, bleak and heavy from the first page to the last.";
const DARK_TOO = "Few books are as relentlessly dark: every chapter is hopeless.";
const DARK_THIRD = "A dark and airless book about the collapse of Europe.";
const SLOW = "The narrative moves slowly, one long dinner after another.";
const SLOW_TOO = "Its pace is slow and deliberate, a long procession of scenes.";
/** The one of some sentences a request's passages hold */
const holding = (request: ExtractionRequest, ...sentences: string[]) => sentences.find((s) => request.messages[0].content.includes(s))!;

describe.skipIf(!url)("the extract stage", () => {
  const c = client!;
  const conn = testDb as unknown as Db;
  const bucket: Record<string, Buffer> = {};
  const objects: EvidenceObjects = {
    putIfMissing: async (key, body) => (key in bucket ? false : ((bucket[key] = body), true)),
    get: async (key) => bucket[key] ?? null,
  };

  /**
   * The model stub: answers each request from the values the test gives, by
   * excerpt, citing the passage that holds it; logs every request
   */
  const sent: ExtractionRequest[] = [];
  let answer: (request: ExtractionRequest) => Partial<ModelAnswer> & { values?: Record<string, { term: string; excerpt: string; passage?: string }[]> };
  const model: ExtractionModel = {
    countTokens: async () => 2_000,
    async send(request) {
      sent.push(request);
      const { values = {}, ...over } = answer(request);
      const asked = Object.keys((request.output_config.format.schema as { properties: object }).properties);
      const body = Object.fromEntries(asked.map((d) => [d, (values[d] ?? []).map((v) => ({ passage: "p1", ...v }))]));
      return {
        model: "claude-opus-5-5",
        stopReason: "end_turn",
        text: JSON.stringify(body),
        usage: { input_tokens: 2_000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        ...over,
      };
    },
  };
  let hasKey = true;
  const stage = () => extractStage({ model: () => (hasKey ? model : null), objects }) as EnrichmentStage;
  const run = (options: Partial<Parameters<typeof runWorker>[1]> = {}) =>
    runWorker(conn, {
      runId: randomUUID(),
      worker: `test:${randomUUID()}`,
      kinds: ["extract"],
      apply: true,
      cache: SourceCache.memory(),
      contact: CONTACT,
      pace: 0,
      stages: { extract: stage() },
      ...options,
    });

  const book = async (title = "Kaputt", id: string = randomUUID()) => {
    const [w] = await c`insert into works ${c({ id, title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 6)}` })} returning id, slug`;
    const [a] = await c`insert into authors(name, slug, last_name) values ('Curzio Malaparte', ${randomUUID()}, 'Malaparte') returning id`;
    await c`insert into work_authors(work_id, author_id, role) values (${w.id}, ${a.id}, 'author')`;
    await enqueueEnrichmentJob({ workId: w.id, kind: "extract", reason: "research" }, conn);
    return w as { id: string; slug: string };
  };
  const store = (workId: string, outletKey: string, text: string) =>
    storeEvidenceText({
      database: conn,
      owner: { kind: "book", workId },
      outlet: outletKey,
      outletName: outletKey.toUpperCase(),
      url: `https://${outletKey}.example/${randomUUID()}`,
      text,
      searchProvider: "tavily",
      query: "Kaputt Curzio Malaparte review",
      runId: randomUUID(),
      objects,
    });
  const claims = (workId: string) =>
    c`select d.key as dimension, t.key as term, c.status, c.decision_reason as reason, c.confidence::float8 as confidence, c.note,
        (select count(*)::int from claim_evidence e where e.claim_id = c.id) as evidence
      from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id join enrichment_terms t on t.id = c.term_id
      where c.work_id = ${workId} order by d.key, t.key, c.created_at`;
  const extractions = (workId: string) =>
    c`select status, values_returned as returned, values_verified as verified, failures, dimension_keys as dimensions, extractor_version, undone_at
      from enrichment_extractions where work_id = ${workId} order by created_at, id`;
  const jobOf = async (workId: string) => (await c`select status, held_reason, payload -> 'outcome' as outcome from enrichment_jobs where work_id = ${workId} and kind = 'extract'`)[0];

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`insert into works(id, title, slug) values ('7c2f1d52-1b8e-4c5a-9d3e-2f6a8b1c4e90', 'Example', 'example-book')`;
    const seed = vocabularySeedSchema.parse(JSON.parse(readFileSync("src/__tests__/fixtures/enrichment/vocabulary.json", "utf8")));
    await testDb!.transaction((tx) => applyVocabulary(tx as unknown as Db, seed, { approvalUrl: APPROVAL, seedSha256: "a".repeat(64) }));
    await applyOutletSeed(conn, OUTLETS, 1);
  }, 60000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client?.end();
  });
  beforeEach(async () => {
    await c`delete from enrichment_jobs`;
    sent.length = 0;
    hasKey = true;
    answer = () => ({});
    vi.stubEnv("ENRICHMENT_MONTHLY_CAP_USD", "100");
  });

  it("plans without a call or a write, with the documents and a cost estimate", async () => {
    const w = await book();
    await store(w.id, "nyrb", review(DARK));
    const before = await c`select (select count(*) from enrichment_costs)::int as costs, (select count(*) from enrichment_extractions)::int as rows`;
    const report = await run({ apply: false });
    expect(sent).toHaveLength(0);
    expect(report.lines).toContain("- Monthly cap: $100.00; spent this month $0.00; left $100.00; ceiling per book $1.50");
    expect(report.lines.join("\n")).toMatch(new RegExp(`${w.slug}: 1 documents, 3 dimensions \\(mood, pace, tone\\), estimate \\$0\\.\\d{3} at most`));
    expect(await c`select (select count(*) from enrichment_costs)::int as costs, (select count(*) from enrichment_extractions)::int as rows`).toEqual(before);
    expect((await jobOf(w.id)).status).toBe("queued");
  });

  it("refuses an apply without ANTHROPIC_API_KEY, before anything runs", async () => {
    await book();
    hasKey = false;
    await expect(run()).rejects.toThrow("Extraction needs ANTHROPIC_API_KEY");
  });

  it("proposes verified values with their text evidence, meters each call, and rejects a value one source alone backs when R6 applies", async () => {
    const w = await book();
    const doc = await store(w.id, "nyrb", review(`${DARK} ${SLOW}`));
    answer = () => ({
      values: {
        tone: [{ term: "dark", excerpt: DARK }],
        pace: [{ term: "slow", excerpt: SLOW }],
        mood: [{ term: "melancholy", excerpt: "a sentence the review never wrote" }],
      },
    });
    const report = await run();
    expect(report.jobs[0].outcome).toMatchObject({ result: "extracted", documents: 1, calls: 1, valuesReturned: 3, valuesVerified: 2, failures: { not_in_passage: 1 }, proposed: 1, rejectedR6: 1 });
    // tone needs two independent sources: one outlet is stored, rejected; pace does not
    expect(await claims(w.id)).toEqual([
      { dimension: "pace", term: "slow", status: "proposed", reason: null, confidence: 0.5, note: null, evidence: 1 },
      { dimension: "tone", term: "dark", status: "rejected", reason: "not_independent", confidence: 0.5, note: null, evidence: 1 },
    ]);
    const [evidence] = await c`select e.locator, e.excerpt, e.start_offset, e.end_offset, e.text_sha256, e.extractor_version, e.source_record_id
      from claim_evidence e join enrichment_claims c on c.id = e.claim_id join enrichment_dimensions d on d.id = c.dimension_id where c.work_id = ${w.id} and d.key = 'pace'`;
    const text = review(`${DARK} ${SLOW}`);
    expect(evidence).toMatchObject({ locator: "text", excerpt: SLOW, extractor_version: EXTRACTOR_VERSION, source_record_id: doc.id, text_sha256: (doc.payload as { textSha256: string }).textSha256 });
    expect([...text].slice(evidence.start_offset, evidence.end_offset).join("")).toBe(SLOW);
    expect(await extractions(w.id)).toEqual([
      {
        status: "answered",
        returned: 3,
        verified: 2,
        failures: [{ dimension: "mood", term: "melancholy", check: "not_in_passage", excerpt: "a sentence the review never wrote" }],
        dimensions: ["mood", "pace", "tone"],
        extractor_version: EXTRACTOR_VERSION,
        undone_at: null,
      },
    ]);
    expect(await c`select provider, operation, estimated_units, units, cost_usd::float8 as cost, work_id from enrichment_costs where work_id = ${w.id}`).toEqual([
      {
        provider: "anthropic",
        operation: "extract",
        estimated_units: { input_tokens: 2_000, output_tokens: 4_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        units: { input_tokens: 2_000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        cost: 0.014,
        work_id: w.id,
      },
    ]);
    // The request carries the passages and the asked dimensions, never notes or examples
    expect(sent[0].messages[0].content).toContain(DARK);
    expect(JSON.stringify(sent[0])).not.toMatch(/Nadja|Huysmans|example/);
  });

  it("counts two outlets as independent but a syndication group as one, and proposes again with all the evidence when a second source comes", async () => {
    const w = await book();
    await store(w.id, "guardian", review(DARK));
    await store(w.id, "observer", review(DARK_TOO));
    answer = (request) => ({ values: { tone: [{ term: "dark", excerpt: holding(request, DARK, DARK_TOO, DARK_THIRD) }] } });
    await run();
    expect(await claims(w.id)).toEqual([{ dimension: "tone", term: "dark", status: "rejected", reason: "not_independent", confidence: 0.5, note: null, evidence: 2 }]);

    // A later research run stores a second outlet: R6 passes, and the new claim cites all three documents
    await store(w.id, "nyrb", review(DARK_THIRD));
    await enqueueEnrichmentJob({ workId: w.id, kind: "extract", reason: "research" }, conn);
    sent.length = 0;
    await run({ only: [w.slug] });
    // The two documents extracted before are not sent again
    expect(sent).toHaveLength(1);
    expect(await claims(w.id)).toEqual([
      { dimension: "tone", term: "dark", status: "rejected", reason: "not_independent", confidence: 0.5, note: null, evidence: 2 },
      { dimension: "tone", term: "dark", status: "proposed", reason: null, confidence: 0.75, note: null, evidence: 3 },
    ]);
    // Each evidence row keeps the run that verified it
    const [firstRun, secondRun] = (await c`select run_id from enrichment_extractions where work_id = ${w.id} group by run_id order by min(created_at)`).map((r) => r.run_id);
    expect(
      await c`select o.provider, e.run_id from claim_evidence e join source_records o on o.id = e.source_record_id join enrichment_claims c on c.id = e.claim_id
        where c.work_id = ${w.id} and c.status = 'proposed' order by o.provider`,
    ).toEqual([
      { provider: "guardian", run_id: firstRun },
      { provider: "nyrb", run_id: secondRun },
      { provider: "observer", run_id: firstRun },
    ]);
    // So undoing the first run withdraws the claim the second created, and the second run's evidence alone fails R6 again
    const { lines } = await undoRun(conn, { runId: firstRun, apply: true, stages: { extract: stage() } });
    expect(lines.join("\n")).toContain("Extraction: 2 extractions undone; 1 claims withdrawn; 1 values proposed again");
    expect((await claims(w.id)).map((x) => [x.status, x.reason, x.evidence])).toEqual([
      ["rejected", "not_independent", 2],
      ["rejected", "run_undone", 3],
      ["rejected", "not_independent", 1],
    ]);
  });

  it("never counts a publisher page toward R6, and notes a conflict, capping its confidence", async () => {
    const w = await book();
    await store(w.id, "nyrb", review(DARK));
    await store(w.id, "press", review(DARK_TOO));
    answer = (request) => ({
      values: request.messages[0].content.includes(DARK)
        ? { tone: [{ term: "dark", excerpt: DARK }], pace: [{ term: "slow", excerpt: "Curzio Malaparte reports from the eastern front." }] }
        : { tone: [{ term: "dark", excerpt: DARK_TOO }], pace: [{ term: "fast", excerpt: "Curzio Malaparte reports from the eastern front." }] },
    });
    await run();
    expect(await claims(w.id)).toEqual([
      { dimension: "pace", term: "fast", status: "proposed", reason: null, confidence: 0.25, note: "conflicts with slow (NYRB)", evidence: 1 },
      { dimension: "pace", term: "slow", status: "proposed", reason: null, confidence: 0.3, note: "conflicts with fast (PRESS)", evidence: 1 },
      { dimension: "tone", term: "dark", status: "rejected", reason: "not_independent", confidence: 0.63, note: null, evidence: 2 },
    ]);
  });

  it("does not send a document that is not about the book, and records why", async () => {
    const w = await book();
    await store(w.id, "nyrb", "A review of The Skin by Curzio Malaparte, set in Naples in 1943, after the liberation.");
    const report = await run();
    expect(sent).toHaveLength(0);
    expect(report.jobs[0].outcome).toMatchObject({ documents: 1, notAboutWork: 1, calls: 0 });
    expect((await extractions(w.id)).map((x) => x.status)).toEqual(["not_about_work"]);
    // A second run finds it decided
    await enqueueEnrichmentJob({ workId: w.id, kind: "extract", reason: "manual" }, conn);
    await run({ only: [w.slug] });
    expect(await extractions(w.id)).toHaveLength(1);
  });

  it("fails the job, with no row, when the stored text cannot be read; a hash mismatch only skips its document", async () => {
    const w = await book();
    await store(w.id, "nyrb", review(SLOW));
    const unreachable = extractStage({
      model: () => model,
      objects: {
        ...objects,
        get: async () => {
          throw new Error("The bucket could not be reached");
        },
      },
    });
    const report = await run({ stages: { extract: unreachable as EnrichmentStage } });
    expect(report.jobs[0].error).toBe("The bucket could not be reached");
    expect((await jobOf(w.id)).status).not.toBe("done");
    expect(await extractions(w.id)).toEqual([]);

    const tampered = extractStage({ model: () => model, objects: { ...objects, get: async () => Buffer.from("Another text.") } });
    await c`update enrichment_jobs set run_after = now() where work_id = ${w.id}`;
    const again = await run({ only: [w.slug], stages: { extract: tampered as EnrichmentStage } });
    expect(again.jobs[0].outcome).toMatchObject({ documents: 1, skipped: ["its text does not match its hash"], calls: 0 });
    expect(sent).toHaveLength(0);
  });

  it("queues a book again for a research dimension it was never extracted for", async () => {
    const w = await book();
    await enqueueEnrichmentJob({ workId: w.id, kind: "extract", reason: "manual", dimensions: ["pace"] }, conn);
    await store(w.id, "nyrb", review(SLOW));
    await run();
    expect((await extractions(w.id)).map((x) => x.dimensions)).toEqual([["pace"]]);
    const plan = await run({ apply: false });
    expect(plan.lines).toContain(`  - ${w.slug}: mood, tone`);
  });

  it.each([
    ["a refusal", { stopReason: "refusal" }],
    ["a cut answer", { stopReason: "max_tokens" }],
    ["another model", { model: "claude-sonnet-5-5" }],
    ["text that is not JSON", { text: "dark" }],
    ["a term outside the vocabulary", { text: JSON.stringify({ tone: [{ term: "eerie", excerpt: DARK, passage: "p1" }], pace: [], mood: [] }) }],
  ])("records %s as an invalid answer, with no claim", async (_, over) => {
    const w = await book();
    await store(w.id, "nyrb", review(DARK));
    answer = () => ({ ...over, values: { tone: [{ term: "dark", excerpt: DARK }] } });
    const report = await run();
    expect(report.jobs[0].outcome).toMatchObject({ calls: 1, invalidAnswers: 1, valuesReturned: 0 });
    expect((await extractions(w.id)).map((x) => x.status)).toEqual(["invalid_answer"]);
    expect(await claims(w.id)).toEqual([]);
    // It was paid: a cost row
    expect((await c`select count(*)::int as n from enrichment_costs where work_id = ${w.id}`)[0].n).toBe(1);
  });

  it("holds the job without a call or a row when the budget is not set, or the book is at its ceiling", async () => {
    const w = await book();
    await store(w.id, "nyrb", review(DARK));
    vi.stubEnv("ENRICHMENT_MONTHLY_CAP_USD", "");
    await run();
    expect(await jobOf(w.id)).toMatchObject({ status: "held", held_reason: "budget" });
    vi.stubEnv("ENRICHMENT_MONTHLY_CAP_USD", "100");
    await c`insert into enrichment_costs (provider, operation, status, estimated_units, estimated_cost_usd, units, cost_usd, price_version, work_id, settled_at)
      values ('anthropic', 'extract', 'settled', '{}', 1.49, '{}', 1.49, 'test', ${w.id}, now())`;
    await run({ only: [w.slug] });
    expect(await jobOf(w.id)).toMatchObject({ status: "held", held_reason: "work_cost_ceiling" });
    expect(sent).toHaveLength(0);
    expect(await extractions(w.id)).toEqual([]);
  });

  it("does not pay twice for an answer kept in the run's cache", async () => {
    const w = await book();
    await store(w.id, "nyrb", review(SLOW));
    answer = () => ({ values: { pace: [{ term: "slow", excerpt: SLOW }] } });
    const cache = SourceCache.memory();
    // The first apply fails at its write: the answer stays in the cache
    const failing = extractStage({ model: () => model, objects });
    const write = failing.write;
    failing.write = async () => {
      throw new Error("The write failed");
    };
    await run({ cache, stages: { extract: failing as EnrichmentStage } });
    expect(await jobOf(w.id)).toMatchObject({ status: "queued" });
    failing.write = write;
    await c`update enrichment_jobs set run_after = now() where work_id = ${w.id}`;
    await run({ cache, only: [w.slug], stages: { extract: failing as EnrichmentStage } });
    expect(sent).toHaveLength(1);
    expect((await claims(w.id)).map((x) => x.term)).toEqual(["slow"]);
  });

  it("changes nothing in the catalogue: no taxonomy link, no work column", async () => {
    const w = await book();
    await store(w.id, "nyrb", review(SLOW));
    answer = () => ({ values: { pace: [{ term: "slow", excerpt: SLOW }] } });
    // The work and every table that links a row to it, but the enrichment's own
    const snapshot = async () => {
      const tables = await c`select table_name as name from information_schema.columns where table_schema = 'public' and column_name = 'work_id'
        and table_name not in ('enrichment_claims', 'enrichment_extractions', 'enrichment_jobs', 'enrichment_costs', 'source_records') order by table_name`;
      const linked: Record<string, unknown> = {};
      for (const { name } of tables) linked[name] = await c`select * from ${c(name)} where work_id = ${w.id}`;
      return [await c`select * from works where id = ${w.id}`, linked];
    };
    const before = await snapshot();
    await run();
    expect(await snapshot()).toEqual(before);
  });

  it("undoes a run: its extractions, its open claims, and proposes again what other runs found", async () => {
    const w = await book();
    await store(w.id, "nyrb", review(SLOW));
    answer = (request) => ({ values: { pace: [{ term: "slow", excerpt: holding(request, SLOW, SLOW_TOO) }] } });
    await run();
    await store(w.id, "lrb", review(SLOW_TOO));
    await enqueueEnrichmentJob({ workId: w.id, kind: "extract", reason: "research" }, conn);
    const second = await run({ only: [w.slug] });
    const secondRun = (await c`select run_id from enrichment_extractions where work_id = ${w.id} order by created_at desc limit 1`)[0].run_id;
    expect(second.jobs[0].outcome).toMatchObject({ merged: 1 });
    expect(await claims(w.id)).toEqual([{ dimension: "pace", term: "slow", status: "proposed", reason: null, confidence: 0.75, note: null, evidence: 2 }]);

    const { lines } = await undoRun(conn, { runId: secondRun, apply: true, stages: { extract: stage() } });
    expect(lines.join("\n")).toContain("Extraction: 1 extractions undone; 1 claims withdrawn; 1 values proposed again");
    expect(await claims(w.id)).toEqual([
      { dimension: "pace", term: "slow", status: "rejected", reason: "run_undone", confidence: 0.75, note: null, evidence: 2 },
      { dimension: "pace", term: "slow", status: "proposed", reason: null, confidence: 0.5, note: null, evidence: 1 },
    ]);
    expect((await extractions(w.id)).map((x) => x.undone_at === null)).toEqual([true, false]);
  });

  it("queues the books a vocabulary change touches, closes their older claims and extracts only those dimensions", async () => {
    const w = await book();
    await store(w.id, "nyrb", review(`${DARK} ${SLOW}`));
    // A book whose only document is not about it: no call, but its rows follow the vocabulary too
    const other = await book("Kaputt");
    await store(other.id, "lrb", "A review of The Skin by Curzio Malaparte, set in Naples in 1943.");
    answer = () => ({ values: { pace: [{ term: "slow", excerpt: SLOW }], mood: [{ term: "melancholy", excerpt: DARK }] } });
    await run();
    expect((await claims(w.id)).map((x) => [x.dimension, x.status])).toEqual([
      ["mood", "proposed"],
      ["pace", "proposed"],
    ]);

    // Version 2 adds a mood term
    const v1 = vocabularySeedSchema.parse(JSON.parse(readFileSync("src/__tests__/fixtures/enrichment/vocabulary.json", "utf8")));
    const v2 = vocabularySeedSchema.parse({
      ...v1,
      version: 2,
      dimensions: v1.dimensions.map((d) =>
        d.key === "mood"
          ? { ...d, terms: [...d.terms, { ...d.terms[0], key: "wistful", label: "Wistful", definition: "Sad with longing.", examples: d.terms[1].examples }] }
          : d,
      ),
    });
    await testDb!.transaction((tx) => applyVocabulary(tx as unknown as Db, v2, { approvalUrl: APPROVAL, seedSha256: "b".repeat(64) }));
    sent.length = 0;
    answer = () => ({ values: { mood: [{ term: "wistful", excerpt: DARK }] } });
    // The sweep queues the book (and the earlier tests' books); the run after works it
    expect((await run({ only: [w.slug] })).lines.join("\n")).toMatch(/queued \d+ books to extract again for a vocabulary change/);
    expect(await c`select status, payload from enrichment_jobs where work_id = ${w.id} and status = 'queued'`).toEqual([
      { status: "queued", payload: { reason: "vocabulary", dimensions: ["mood"] } },
    ]);
    await run({ only: [w.slug] });
    expect(sent).toHaveLength(1);
    expect(Object.keys((sent[0].output_config.format.schema as { properties: object }).properties)).toEqual(["mood"]);
    expect((await claims(w.id)).map((x) => [x.dimension, x.term, x.status, x.reason])).toEqual([
      ["mood", "melancholy", "rejected", "vocabulary_changed"],
      ["mood", "wistful", "proposed", null],
      ["pace", "slow", "proposed", null],
    ]);
    await run({ only: [other.slug] });
    expect(sent).toHaveLength(1);
    expect((await extractions(other.id)).map((x) => x.status)).toEqual(["not_about_work", "not_about_work"]);
    // Nothing of either book is left to extract again
    const plan = (await run({ apply: false })).lines.join("\n");
    expect(plan).toMatch(/- \d+ books to extract again for a vocabulary change/);
    expect(plan).not.toContain(`  - ${w.slug}:`);
    expect(plan).not.toContain(`  - ${other.slug}:`);
  });

  it("hides a gold-set book's values in the report and the job outcome: counts only", async () => {
    const w = await book("Kaputt", GOLD_SET_WORK_IDS[0]);
    await store(w.id, "nyrb", review(SLOW));
    answer = () => ({ values: { pace: [{ term: "slow", excerpt: SLOW }] } });
    const report = await run();
    const text = report.lines.join("\n");
    expect(text).not.toContain(SLOW);
    expect(text).toContain("(a gold-set book: 1 proposals hidden)");
    expect((await jobOf(w.id)).outcome).toMatchObject({ proposed: 1, hidden: true });
    expect((await jobOf(w.id)).outcome).not.toHaveProperty("proposals");
  });

  it("counts the reviews found once research and extraction are done, a syndication group once", async () => {
    const w = await book();
    await store(w.id, "guardian", review(DARK));
    await store(w.id, "observer", review(DARK_TOO));
    await store(w.id, "lrb", review(SLOW));
    await store(w.id, "nyrb", "Nothing about it here at all: The Skin by Curzio Malaparte.");
    await store(w.id, "press", review(SLOW));
    expect(await countReviewsFound(conn, [w.id])).toEqual(new Map([[w.id, null]]));
    await run();
    await c`insert into enrichment_jobs (work_id, kind, status, payload, finished_at) values (${w.id}, 'research', 'done', '{}', now())`;
    const counted = (await countReviewsFound(conn, [w.id])).get(w.id)!;
    expect(counted.count).toBe(2);
    expect(counted.counted.map((s) => s.syndicationGroup ?? s.outlet).sort()).toEqual(["gnm", "lrb"]);
  });

  it("sends cached requests again for the determinism check, writing only cost rows", async () => {
    const w = await book();
    await store(w.id, "nyrb", review(SLOW));
    answer = () => ({ values: { pace: [{ term: "slow", excerpt: SLOW }] } });
    const cache = SourceCache.memory();
    await run({ cache });
    const claimsBefore = await claims(w.id);
    const lines = await determinismCheck(conn, { n: 5, cache, runId: randomUUID(), model });
    expect(lines).toEqual(["## Determinism: 1 requests sent again", expect.stringMatching(/^- [0-9a-f]{12}: the same values$/)]);
    expect(await claims(w.id)).toEqual(claimsBefore);
    expect((await c`select count(*)::int as n from enrichment_costs where work_id is null and provider = 'anthropic'`)[0].n).toBe(1);
  });

  it("closes a retired dimension's open claims and never proposes a retired value again on an undo", async () => {
    const first = await book();
    const second = await book();
    await store(first.id, "nyrb", review(DARK));
    await store(second.id, "nyrb", review(DARK));
    answer = () => ({ values: { mood: [{ term: "wistful", excerpt: DARK }] } });
    await run();
    await store(first.id, "lrb", review(DARK_TOO));
    await enqueueEnrichmentJob({ workId: first.id, kind: "extract", reason: "research" }, conn);
    answer = (request) => ({ values: { mood: [{ term: "wistful", excerpt: holding(request, DARK, DARK_TOO) }] } });
    await run({ only: [first.slug] });
    const secondRun = (await c`select run_id from enrichment_extractions where work_id = ${first.id} order by created_at desc limit 1`)[0].run_id;

    // Version 3 retires the mood dimension and its terms
    const v1 = vocabularySeedSchema.parse(JSON.parse(readFileSync("src/__tests__/fixtures/enrichment/vocabulary.json", "utf8")));
    const v3 = vocabularySeedSchema.parse({ ...v1, version: 3, dimensions: v1.dimensions.filter((d) => d.key !== "mood") });
    await testDb!.transaction((tx) => applyVocabulary(tx as unknown as Db, v3, { approvalUrl: APPROVAL, seedSha256: "c".repeat(64) }));

    // The undo withdraws the first book's claim and does not propose the retired value again
    const { lines } = await undoRun(conn, { runId: secondRun, apply: true, stages: { extract: stage() } });
    expect(lines.join("\n")).toContain("1 claims withdrawn; 0 values proposed again");
    // The sweep closes the second book's open claim and queues nobody for mood
    const report = (await run({ only: [second.slug] })).lines.join("\n");
    // Every book's open mood claims close, this book's among them
    expect(report).toMatch(/- closed [1-9]\d* open claims of retired dimensions/);
    expect((await claims(second.id)).map((x) => [x.term, x.status, x.reason])).toEqual([["wistful", "rejected", "vocabulary_changed"]]);
    expect((await run({ apply: false })).lines.join("\n")).not.toMatch(/: .*mood/);
  });

  it("bills the Brave check only for an answered search, and makes no call without a cap", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "brave-test");
    const answers: (() => Promise<Response>)[] = [];
    vi.stubGlobal("fetch", () => answers.shift()!());
    const checks = () => c`select status, cost_usd::float8 as cost from enrichment_costs where provider = 'brave' and operation = 'check' order by created_at`;
    try {
      vi.stubEnv("ENRICHMENT_MONTHLY_CAP_USD", "");
      expect(await runIntegrationCheck("braveSearch")).toEqual({ status: "warning", message: "ENRICHMENT_MONTHLY_CAP_USD is not set: no check call was made" });
      vi.stubEnv("ENRICHMENT_MONTHLY_CAP_USD", "100");
      answers.push(async () => new Response("{}", { status: 401 }));
      expect(await runIntegrationCheck("braveSearch")).toEqual({ status: "error", message: "Brave Search refused the key" });
      answers.push(async () => {
        throw new TypeError("fetch failed");
      });
      expect((await runIntegrationCheck("braveSearch")).message).toBe("Brave Search could not be reached");
      answers.push(async () => new Response("{}", { status: 200 }));
      expect((await runIntegrationCheck("braveSearch")).status).toBe("ok");
      expect(await checks()).toEqual([
        { status: "released", cost: null },
        { status: "released", cost: null },
        { status: "settled", cost: 0.005 },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps extractions append-only: no delete, no change but one undo time", async () => {
    const w = await book();
    await store(w.id, "nyrb", review(SLOW));
    answer = () => ({ values: { pace: [{ term: "slow", excerpt: SLOW }] } });
    await run();
    const [{ id }] = await c`select id from enrichment_extractions where work_id = ${w.id}`;
    await expect(c`delete from enrichment_extractions where id = ${id}`).rejects.toThrow();
    await expect(c`update enrichment_extractions set values_verified = 0 where id = ${id}`).rejects.toThrow();
    await c`update enrichment_extractions set undone_at = now() where id = ${id}`;
    await expect(c`update enrichment_extractions set undone_at = now() where id = ${id}`).rejects.toThrow();
    // Deleting the book removes its extractions with it
    await c`delete from enrichment_jobs where work_id = ${w.id}`;
    await c`delete from works where id = ${w.id}`;
    expect((await c`select count(*)::int as n from enrichment_extractions where work_id = ${w.id}`)[0].n).toBe(0);
  });
});
