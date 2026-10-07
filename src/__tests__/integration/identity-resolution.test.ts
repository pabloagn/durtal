import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";

const url = process.env.DURTAL_IDENTITY_RESOLUTION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln464_identity_resolution")
    throw new Error("Identity resolution tests require disposable local sln464_identity_resolution");
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
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
// The queue can be made to fail, to show a save never does
const queue = vi.hoisted(() => ({ down: false }));
vi.mock("@/lib/enrichment/jobs", async (importOriginal) => {
  const jobs = await importOriginal<typeof import("@/lib/enrichment/jobs")>();
  return {
    ...jobs,
    enqueueEnrichmentJob: (...args: Parameters<typeof jobs.enqueueEnrichmentJob>) => {
      if (queue.down) throw new Error("The queue is down");
      return jobs.enqueueEnrichmentJob(...args);
    },
  };
});
import { assertReadOnly, enqueueScope, runWorker, undoRun } from "@/lib/enrichment/worker";
import { QuotaStop, SourceCache } from "@/lib/enrichment/source-cache";
import type { EnrichmentStage } from "@/lib/enrichment/stages";
import { BULK_ACCESSION_PRIORITY, queueNewBookEnrichment } from "@/lib/enrichment/queue";
import { claimNextEnrichmentJob, enqueueEnrichmentJob } from "@/lib/enrichment/jobs";
import { applyClaim, proposeClaims } from "@/lib/enrichment/claims";
import { applyVocabulary } from "@/lib/enrichment/loader";
import { vocabularySeedSchema } from "@/lib/validations/enrichment";
import { createWork } from "@/lib/actions/works";
import { createHumanClaim, currentVocabularyVersion } from "@/lib/enrichment/claims";
import { identityStage } from "@/lib/enrichment/identity-stage";
import { disableIdentityRules, enableIdentityRules } from "@/lib/enrichment/identity-rules";
import { ANSWER, IDENTITY_RULES_VERSION } from "@/lib/enrichment/identity";
import type { IdentityReviewEntry } from "@/lib/enrichment/identity-review";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { KAPUTT_HIT, RETRIEVED_AT, recordedAnswers } from "@/__tests__/fixtures/enrichment/identity/answers";

/*
 * SLN-464: the enrichment worker and the new-book queue, with a stub stage;
 * then the identity stage on recorded answers. No network: fetch throws.
 */

describe.skipIf(!url)("the enrichment worker", () => {
  const c = client!;
  const conn = testDb as unknown as Db;
  const CONTACT = "durtal@example.org";
  /** What the stub stage did: its undo calls, and where its fetch is refused */
  const stub = {
    undone: [] as string[],
    refuseAfter: null as number | null,
    during: null as null | (() => Promise<void>),
    writing: null as null | ((jobId: string) => Promise<void>),
    takeover: false,
  };
  const stage: EnrichmentStage<{ title: string }> = {
    kind: "identity",
    callsOut: true,
    async fetch(_conn, jobs, ctx) {
      for (const [i, job] of jobs.entries()) {
        if (ctx.cache.get(`work:${job.workId}`)) continue;
        if (stub.refuseAfter !== null && i >= stub.refuseAfter) throw new QuotaStop("The source refused a call (HTTP 429)", i);
        ctx.cache.set(`work:${job.workId}`, { title: job.title });
      }
      await stub.during?.();
    },
    async plan(_conn, job, ctx) {
      const title = (ctx.cache.get(`work:${job.workId}`)?.answer as { title: string }).title;
      return { plan: { title }, summary: `would note ${title}` };
    },
    async write(tx, job, plan, ctx) {
      if (plan.title === "Unreadable") throw new Error("The answer could not be read");
      await stub.writing?.(job.id);
      // Another worker takes the job over while this write runs
      if (stub.takeover) await client!`update enrichment_jobs set locked_by = 'other', locked_at = now() where id = ${job.id}`;
      await tx.execute(sql`update works set notes = ${`run ${ctx.runId}`} where id = ${job.workId}::uuid`);
      return { result: "resolved" };
    },
    steps: [{ name: "Sweep", plan: async () => ["- would sweep"], apply: async () => ["- swept"] }],
    async undo(_tx, runId) {
      stub.undone.push(runId);
      return [`stub undid ${runId}`];
    },
  };
  const run = (options: Partial<Parameters<typeof runWorker>[1]> = {}) =>
    runWorker(conn, {
      runId: randomUUID(),
      worker: "test",
      kinds: ["identity"],
      apply: true,
      cache: SourceCache.memory(),
      contact: CONTACT,
      stages: { identity: stage as EnrichmentStage },
      ...options,
    });
  const book = async (title: string, fields: Record<string, unknown> = {}) => {
    const [w] = await c`insert into works ${c({ title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 6)}`, ...fields })} returning id, slug`;
    return w as { id: string; slug: string };
  };
  const queued = async (title: string) => {
    const w = await book(title);
    await enqueueEnrichmentJob({ workId: w.id, kind: "identity", reason: "manual" }, conn);
    return w;
  };
  const job = async (workId: string) =>
    (await c`select status, attempts, held_reason, last_error, run_after > now() as later, payload from enrichment_jobs where work_id = ${workId}`)[0];
  const notes = async (workId: string) => (await c`select notes from works where id = ${workId}`)[0].notes as string | null;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`delete from enrichment_jobs`;
    Object.assign(stub, { refuseAfter: null, during: null, writing: null, takeover: false });
  });

  it("refuses a kind without a stage, and a stage that calls out without a contact", async () => {
    await expect(run({ kinds: ["facts"] })).rejects.toThrow("No enrichment stage works facts jobs yet");
    await expect(run({ contact: null })).rejects.toThrow("The identity stage calls outside services: set ENRICHMENT_CONTACT");
  });

  it("plans without writing: every table stays as it was; a read-only session passes the probe", async () => {
    const a = await queued("Planned one");
    await queued("Planned two");
    const snapshot = async () => [await c`select * from enrichment_jobs order by id`, await c`select id, notes, updated_at from works order by id`];
    const before = await snapshot();
    const report = await run({ apply: false });
    expect(report.lines).toContain("- would sweep");
    expect(report.lines.some((l) => l.includes(`${a.slug}: would note Planned one`))).toBe(true);
    expect(await snapshot()).toEqual(before);
    await expect(assertReadOnly(conn)).rejects.toThrow("The database accepted a write in a read-only session");
    const readOnly = postgres(url!, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true } });
    try {
      await assertReadOnly(drizzle(readOnly, { schema }) as unknown as Db);
    } finally {
      await readOnly.end();
    }
  });

  it("releases quota, rate-limit and budget holds and works them; a book's cost ceiling stays held", async () => {
    const [due, quota, budget, ceiling] = [await queued("Due"), await queued("Quota"), await queued("Budget"), await queued("Ceiling")];
    for (const [w, reason] of [[quota, "quota"], [budget, "budget"], [ceiling, "work_cost_ceiling"]] as const)
      await c`update enrichment_jobs set status = 'held', held_reason = ${reason} where work_id = ${w.id}`;
    const report = await run();
    expect(report.lines).toContain("Released 2 held identity jobs");
    expect(report.lines).toContain("- swept");
    for (const w of [due, quota, budget]) {
      expect((await job(w.id)).status, w.slug).toBe("done");
      expect(await notes(w.id)).toMatch(/^run /);
    }
    expect(await job(ceiling.id)).toMatchObject({ status: "held", held_reason: "work_cost_ceiling" });
    expect((await job(due.id)).payload.outcome).toEqual({ result: "resolved" });
  });

  it("works only the named books, releases their cost ceiling, and never takes a job queued after the fetch", async () => {
    const [a, b] = [await queued("Named"), await queued("Not named")];
    await c`update enrichment_jobs set status = 'held', held_reason = 'work_cost_ceiling' where work_id = ${a.id}`;
    let late: { id: string } | null = null;
    stub.during = async () => {
      late = await queued("Queued late");
    };
    const report = await run({ only: [a.slug] });
    expect(report.jobs.map((j) => j.slug)).toEqual([a.slug]);
    expect((await job(a.id)).status).toBe("done");
    expect((await job(b.id)).status).toBe("queued");
    expect((await job(late!.id)).status).toBe("queued");
    await expect(run({ only: ["no-such-book"] })).rejects.toThrow("Unknown book: no-such-book");
  });

  it("writes no job after a refused fetch: they stay queued with no attempt, and the next run continues from the cache", async () => {
    const [a, b] = [await queued("First fetched"), await queued("Refused")];
    const cache = SourceCache.memory();
    stub.refuseAfter = 1;
    const stopped = await run({ cache });
    expect(stopped.stopped).toBe("The source refused a call (HTTP 429)");
    expect(stopped.lines[0]).toMatch(/^Stopped after 1 of 2 jobs/);
    expect(stopped.lines).toContain("- swept");
    for (const w of [a, b]) expect(await job(w.id)).toMatchObject({ status: "queued", attempts: 0 });
    expect(cache.get(`work:${a.id}`)).toBeDefined();
    expect(cache.get(`work:${b.id}`)).toBeUndefined();
    stub.refuseAfter = null;
    await run({ cache });
    for (const w of [a, b]) expect((await job(w.id)).status).toBe("done");
  });

  it("fails a job whose write breaks, with its backoff, and goes on", async () => {
    const [bad, good] = [await queued("Unreadable"), await queued("Readable")];
    const report = await run();
    expect(report.jobs.find((j) => j.slug === bad.slug)?.error).toBe("The answer could not be read");
    expect(await job(bad.id)).toMatchObject({ status: "queued", attempts: 1, last_error: "The answer could not be read", later: true });
    expect(await notes(bad.id)).toBeNull();
    expect((await job(good.id)).status).toBe("done");
  });

  it("renews a job's lease on its own connection while the write runs", async () => {
    const w = await queued("Slow write");
    const leases: number[] = [];
    const lease = async (jobId: string) => (await c`select extract(epoch from locked_at)::float8 as t from enrichment_jobs where id = ${jobId}`)[0].t as number;
    stub.writing = async (jobId) => {
      leases.push(await lease(jobId));
      await new Promise((r) => setTimeout(r, 150));
      leases.push(await lease(jobId));
    };
    const report = await run({ worker: `test:${randomUUID()}`, heartbeat: { conn, everyMs: 40 } });
    expect(report.jobs.map((j) => j.outcome)).toEqual([{ result: "resolved" }]);
    expect(leases[1]).toBeGreaterThan(leases[0]);
    expect((await job(w.id)).status).toBe("done");
  });

  it("works a job a crashed run left running once its lease is abandoned, and never one still leased", async () => {
    const [a, b, live] = [await queued("Crashed one"), await queued("Crashed two"), await queued("Still running")];
    // A run claimed these, then stopped before it finished them (Ctrl-C, a crash)
    for (const [w, worker] of [[a, "gone"], [b, "gone"], [live, "alive"]] as const)
      await claimNextEnrichmentJob({ worker, kinds: ["identity"], workIds: [w.id] }, conn);
    await c`update enrichment_jobs set locked_at = now() - interval '31 minutes' where work_id in (${a.id}, ${b.id})`;
    await run({ only: [b.slug] });
    expect((await job(b.id)).status).toBe("done");
    await run();
    expect((await job(a.id)).status).toBe("done");
    expect(await job(live.id)).toMatchObject({ status: "running" });
    expect(await notes(live.id)).toBeNull();
  });

  it("rolls back a write whose job another worker took over", async () => {
    const w = await queued("Taken over");
    stub.takeover = true;
    const report = await run();
    expect(report.jobs[0].error).toBe("Another worker took this job over; its write is rolled back");
    expect(await notes(w.id)).toBeNull();
    expect((await c`select status, locked_by from enrichment_jobs where work_id = ${w.id}`)[0]).toEqual({ status: "running", locked_by: "other" });
  });

  it("undoes a run: its applies newest first, refusing one that changed since, and each stage's own writes", async () => {
    const seed = vocabularySeedSchema.parse(JSON.parse(readFileSync("src/__tests__/fixtures/enrichment/vocabulary.json", "utf8")));
    const kept = await book("Example kept");
    await c`insert into harmonization_redirects(source_id, entity, target_id) values ('7c2f1d52-1b8e-4c5a-9d3e-2f6a8b1c4e90', 'works', ${kept.id})`;
    await testDb!.transaction((tx) => applyVocabulary(tx as unknown as Db, seed, { approvalUrl: "https://linear.app/x/approval", seedSha256: "a".repeat(64) }));
    const runId = randomUUID();
    const w = await book("Undone");
    const json = JSON.stringify({ title: "El desierto", year: "1951" });
    const [s] = await c`insert into source_records(entity_kind, work_id, provider, retrieved_at, payload, payload_hash, review_status)
      values ('book', ${w.id}, 'wikidata', now(), ${json}::jsonb, ${"b".repeat(64)}, 'accepted') returning id`;
    const evidence = (excerpt: string, path: string[]) => ({ locator: "payload" as const, sourceRecordId: s.id, extractorVersion: "test", excerpt, payloadPath: path });
    const [title, year] = await proposeClaims(
      [
        { workId: w.id, dimension: "original_title", value: { text: "El desierto" }, method: "api", confidence: 1, vocabularyVersion: 1, runId, evidence: [evidence("El desierto", ["title"])] },
        { workId: w.id, dimension: "composition_year", value: { number: 1951 }, method: "api", confidence: 1, vocabularyVersion: 1, runId, evidence: [evidence("1951", ["year"])] },
      ],
      conn,
    );
    for (const claim of [title, year]) await applyClaim((claim as { claimId: string }).claimId, { by: "pablo", batchId: runId }, conn);
    // The title changed by hand since: its undo is refused
    await c`update works set original_title = 'Changed by hand' where id = ${w.id}`;
    expect((await undoRun(conn, { runId, apply: false, stages: { identity: stage as EnrichmentStage } })).lines[0]).toBe(`Run ${runId}: 2 applies to undo, newest first`);
    const undone = await undoRun(conn, { runId, apply: true, stages: { identity: stage as EnrichmentStage } });
    expect(undone.undone).toHaveLength(1);
    expect(undone.refused).toEqual([{ id: expect.any(String), reason: "The value changed since it was applied; undo it from its newer apply first" }]);
    expect(await c`select count(*)::int as n from work_enrichment_values where work_id = ${w.id}`).toEqual([{ n: 0 }]);
    expect(stub.undone).toContain(runId);
  });

  it("queues a scope with its priority: counts only until applied", async () => {
    const [location] = await c`insert into locations(name, type) values ('Study', 'physical') returning id`;
    const owned = await book("Owned book");
    const [edition] = await c`insert into editions(work_id, title) values (${owned.id}, 'Owned') returning id`;
    await c`insert into instances(edition_id, location_id) values (${edition.id}, ${location.id})`;
    const ordered = await book("Ordered book", { catalogue_status: "on_order" });
    const wanted = await book("Wanted book", { catalogue_status: "wanted" });
    const counted = await enqueueScope(conn, { kind: "identity", scope: "owned", only: [owned.slug], apply: false });
    expect(counted.books).toBe(1);
    expect(await c`select id from enrichment_jobs`).toEqual([]);
    for (const [scope, w, priority] of [["owned", owned, 10], ["on_order", ordered, 20], ["wanted", wanted, 30]] as const) {
      await enqueueScope(conn, { kind: "identity", scope, only: [w.slug], apply: true });
      expect((await c`select priority, payload->>'reason' as reason from enrichment_jobs where work_id = ${w.id}`)[0]).toEqual({ priority, reason: "manual" });
    }
    // An owned book is never in the on-order scope
    expect((await enqueueScope(conn, { kind: "identity", scope: "on_order", only: [owned.slug], apply: false })).books).toBe(0);
  });

  it("queues a new book with a priority it is given; a failing queue logs and the save still succeeds", async () => {
    const w = await book("Bulk accession");
    await queueNewBookEnrichment(w.id, { priority: BULK_ACCESSION_PRIORITY });
    expect((await c`select kind, priority, payload->>'reason' as reason from enrichment_jobs where work_id = ${w.id}`)[0]).toEqual({
      kind: "identity",
      priority: 200,
      reason: "created",
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    queue.down = true;
    try {
      const [author] = await c`insert into authors(name, slug) values ('Marcel Schwob', ${randomUUID()}) returning id`;
      const work = await createWork({ title: "Saved anyway", originalLanguage: "en", authorIds: [{ authorId: author.id }] });
      expect(work.id).toBeTruthy();
      expect(errors.mock.calls[0][0]).toMatch(/^\[enrichment\]/);
      expect(await c`select id from enrichment_jobs where work_id = ${work.id}`).toEqual([]);
    } finally {
      queue.down = false;
      errors.mockRestore();
    }
  });

  describe("the identity stage", () => {
    const APPROVAL = "https://linear.app/sanctum-black/issue/SLN-464#comment-rules";
    const DIMENSIONS = ["wikidata_qid", "open_library_work", "oclc_work", "lccn"];
    let location: string;
    /** A book with an author (and their QID), and an edition with its ISBN-13; owned unless `owned` is false */
    const identityBook = async (
      title: string,
      isbn13: string | null,
      options: { authorQid?: string; authorOpenLibraryKey?: string; owned?: boolean; queue?: boolean; edition?: Record<string, unknown> } = {},
    ) => {
      const w = await book(title);
      const [author] = await c`insert into authors(name, slug, open_library_key)
        values (${`Author of ${title}`}, ${randomUUID()}, ${options.authorOpenLibraryKey ?? null}) returning id`;
      await c`insert into work_authors(work_id, author_id, role) values (${w.id}, ${author.id}, 'author')`;
      if (options.authorQid)
        await c`insert into catalogue_identifiers(entity_kind, person_id, provider, external_id) values ('person', ${author.id}, 'wikidata', ${options.authorQid})`;
      const [edition] = await c`insert into editions ${c({ work_id: w.id, title, isbn_13: isbn13, ...options.edition })} returning id`;
      if (options.owned !== false) await c`insert into instances(edition_id, location_id) values (${edition.id}, ${location})`;
      if (options.queue !== false) await enqueueEnrichmentJob({ workId: w.id, kind: "identity", reason: "manual" }, conn);
      return { ...w, editionId: edition.id as string };
    };
    /** A run on the recorded answers; `only` keeps out the books an earlier test's run queued again */
    const identify = (options: Partial<Parameters<typeof runWorker>[1]> = {}) =>
      runWorker(conn, {
        runId: randomUUID(),
        worker: `test:${randomUUID()}`,
        kinds: ["identity"],
        apply: true,
        // Pablo's own QID in one test, which no source has
        cache: recordedAnswers({ [ANSWER.item("Q90000005")]: null }),
        contact: CONTACT,
        ...options,
      });
    const identifiers = async (workId: string, editionId?: string) =>
      (
        await c`select provider, external_id from catalogue_identifiers
          where (entity_kind = 'book' and work_id = ${workId}) or (entity_kind = 'edition' and edition_id = ${editionId ?? workId}) order by provider`
      ).map((r) => `${r.provider} ${r.external_id}`);
    const claimsOf = (workId: string) =>
      c`select d.key, c.text_value as value, c.status, c.decided_by, c.confidence::float8 as confidence, c.decision_reason
        from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id where c.work_id = ${workId} order by d.key, c.text_value`;
    const rulesOn = () => enableIdentityRules(conn, { dimensions: DIMENSIONS, approvalUrl: APPROVAL, apply: true });

    beforeAll(async () => {
      // A lookup missing from the recorded cache would call out: it fails the test instead
      vi.stubEnv("ENRICHMENT_CONTACT", CONTACT);
      vi.stubGlobal("fetch", (url: string) => {
        throw new Error(`No network in tests: ${url}`);
      });
      [{ id: location }] = await c`insert into locations(name, type) values ('Shelves', 'physical') returning id`;
      // Version 2 of the fixture vocabulary: version 1 as it is, and the four identity dimensions
      const v1 = vocabularySeedSchema.parse(JSON.parse(readFileSync("src/__tests__/fixtures/enrichment/vocabulary.json", "utf8")));
      if (!(await currentVocabularyVersion(conn)))
        await testDb!.transaction((tx) => applyVocabulary(tx as unknown as Db, v1, { approvalUrl: APPROVAL, seedSha256: "a".repeat(64) }));
      const v2 = vocabularySeedSchema.parse({
        ...v1,
        version: 2,
        dimensions: [...v1.dimensions, ...JSON.parse(readFileSync("src/__tests__/fixtures/enrichment/identity/dimensions.json", "utf8"))],
      });
      await testDb!.transaction((tx) => applyVocabulary(tx as unknown as Db, v2, { approvalUrl: APPROVAL, seedSha256: "b".repeat(64) }));
    });
    afterAll(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });
    beforeEach(async () => {
      await disableIdentityRules(conn, {});
      // Each test's books are new: the IDs and ISBNs of an earlier test's books would read as another book's
      await c`delete from catalogue_identifiers where entity_kind in ('book', 'edition', 'person') and provider in ('wikidata', 'open_library', 'oclc', 'lccn')`;
      await c`update editions set isbn_13 = null where isbn_13 is not null`;
    });

    it("resolves a book: proposes with evidence, applies the exact IDs by their rules, and writes its identifiers and its edition's LCCN", async () => {
      await rulesOn();
      const w = await identityBook("House of Leaves", "9780375703768", { authorQid: "Q963727", edition: { publication_year: 2000, publisher: "Pantheon", page_count: 709 } });
      const edition = async () => (await c`select * from editions where id = ${w.editionId}`)[0];
      const before = await edition();
      const runId = randomUUID();
      const report = await identify({ runId, only: [w.slug] });
      expect(report.jobs[0].outcome).toMatchObject({ result: "resolved", proposed: 4, applied: 4, waiting: 0 });
      expect(await identifiers(w.id, w.editionId)).toEqual(["lccn 99036024", "oclc 3856843516", "open_library OL32195W", "wikidata Q521688"]);
      // The LCCN column only: every other edition column is as it was
      const after = await edition();
      expect(after.lccn).toBe("99036024");
      expect({ ...after, lccn: null, updated_at: null }).toEqual({ ...before, lccn: null, updated_at: null });
      expect(await c`select distinct c.status, c.decided_by, a.batch_id from enrichment_claims c join enrichment_applications a on a.claim_id = c.id where c.work_id = ${w.id}`).toEqual([
        { status: "accepted", decided_by: "rule", batch_id: runId },
      ]);
      // Every excerpt is the stored answer's value at its path, and every answer names its source
      const [evidence] = await c`select count(*)::int as n, bool_and(e.excerpt = s.payload #>> e.payload_path) as exact,
          bool_and(e.extractor_version = ${IDENTITY_RULES_VERSION} and e.run_id = ${runId}) as stamped,
          bool_and(s.url like 'https://%' and s.attribution is not null and s.retrieved_at = ${RETRIEVED_AT.toISOString()}::timestamptz
            and s.payload ->> 'runId' = ${runId} and s.identifier_id is null and s.review_status = 'accepted') as sourced
        from claim_evidence e join source_records s on s.id = e.source_record_id join enrichment_claims c on c.id = e.claim_id where c.work_id = ${w.id}`;
      expect(evidence).toEqual({ n: expect.any(Number), exact: true, stamped: true, sourced: true });
      expect(evidence.n).toBeGreaterThanOrEqual(11);
      expect((await job(w.id)).payload.outcome).toMatchObject({ result: "resolved" });
      expect(report.lines.join("\n")).toContain("Wikidata item by its P648 (reverse lookup): 1; by the Open Library work's link: 1; by both: 1");
    });

    it("runs a book twice and adds no claim; a value that differs from the accepted one waits for review and is never applied", async () => {
      await rulesOn();
      const life = await identityBook("Life and Fate", "9781784871963", { authorQid: "Q313767" });
      await identify({ only: [life.slug] });
      const claims = await claimsOf(life.id);
      await enqueueEnrichmentJob({ workId: life.id, kind: "identity", reason: "manual" }, conn);
      const again = await identify({ only: [life.slug] });
      expect(again.jobs[0].outcome).toMatchObject({ result: "resolved", proposed: 0, applied: 0 });
      expect(await claimsOf(life.id)).toEqual(claims);

      const pity = await identityBook("Beware of Pity", "9780241678763");
      await createHumanClaim({ workId: pity.id, dimension: "wikidata_qid", value: { text: "Q90000005" } }, conn);
      await identify({ only: [pity.slug] });
      expect((await claimsOf(pity.id)).find((x) => x.value === "Q1428590")).toMatchObject({ status: "proposed", confidence: 0.4 });
      expect(await identifiers(pity.id)).toContain("wikidata Q90000005");
      expect(await identifiers(pity.id)).not.toContain("wikidata Q1428590");
    });

    it("leaves a doubtful QID proposed with nothing on the book, and the report gives a ready review entry", async () => {
      await rulesOn();
      const w = await identityBook("2666", "9780374100148");
      const report = await identify({ only: [w.slug] });
      expect(report.jobs[0].outcome).toMatchObject({ result: "review", applied: 2 });
      expect((await claimsOf(w.id)).find((x) => x.key === "wikidata_qid")).toMatchObject({ value: "Q219437", status: "proposed", confidence: 0.4 });
      expect((await identifiers(w.id, w.editionId)).some((i) => i.startsWith("wikidata"))).toBe(false);
      expect(report.lines).toContain(`  ${JSON.stringify(w.slug)}: { title: "2666", wikidata_qid: null, note: "" },`);
    });

    it("holds a QID another book has, lists both books, and Harmonize merges the pair", async () => {
      await rulesOn();
      const first = await identityBook("Satantango, first copy", null, { queue: false });
      await createHumanClaim({ workId: first.id, dimension: "wikidata_qid", value: { text: "Q1315145" } }, conn);
      const second = await identityBook("Satantango", "9781788166355");
      const report = await identify({ only: [second.slug] });
      expect(report.jobs.find((j) => j.slug === second.slug)!.outcome).toMatchObject({
        result: "collision",
        collisions: [{ dimension: "wikidata_qid", value: "Q1315145", workId: first.id, slug: first.slug }],
      });
      expect((await claimsOf(second.id)).some((x) => x.key === "wikidata_qid")).toBe(false);
      expect(report.lines).toContain(`  ${JSON.stringify(second.slug)}: { title: "Satantango", wikidata_qid: null, note: "" },`);
      expect(report.lines.some((l) => l.startsWith(`- ${second.slug}: collision`) && l.includes(`/library/${first.slug}`))).toBe(true);
      // Both books have identity claims and jobs: the merge moves them
      const preview = await previewMerge("works", second.id, first.id);
      expect(preview.blockers).toEqual([]);
      await executeMerge({
        entity: "works",
        sourceId: second.id,
        targetId: first.id,
        fingerprint: preview.fingerprint,
        choices: Object.fromEntries(preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target" as const])),
      });
      expect(await c`select id from works where id = ${second.id}`).toEqual([]);
      expect(await identifiers(first.id)).toEqual(["open_library OL3428975W", "wikidata Q1315145"]);
    });

    it("applies an Open Library work with another author record when Wikidata confirms it, and leaves it for review when nothing does", async () => {
      await rulesOn();
      // Durtal's author keys on the newest backup; the Open Library works name the other records of these authors
      const life = await identityBook("Life and Fate", "9781784871963", { authorQid: "Q313767", authorOpenLibraryKey: "/authors/OL4655492A" });
      const bolano = await identityBook("2666, duplicate author", "9780374100148", { authorOpenLibraryKey: "/authors/OL6493404A" });
      await identify({ only: [life.slug, bolano.slug] });
      expect(await identifiers(life.id)).toEqual(["open_library OL157104W", "wikidata Q979609"]);
      expect((await claimsOf(bolano.id)).find((x) => x.key === "open_library_work")).toMatchObject({ value: "OL712025W", status: "proposed", confidence: 0.4 });
      expect((await identifiers(bolano.id)).some((i) => i.startsWith("open_library"))).toBe(false);
    });

    it("keeps exact claims proposed while their rule is off, and a later run's sweep applies them", async () => {
      const w = await identityBook("Life and Fate, again", "9781784871963", { authorQid: "Q313767" });
      const off = await identify({ only: [w.slug] });
      expect(off.jobs[0].outcome).toMatchObject({ result: "resolved", applied: 0, waiting: 2 });
      expect(off.lines).toContain(`- ${w.slug}: wikidata_qid Q979609 https://www.wikidata.org/wiki/Q979609`);
      expect(await identifiers(w.id)).toEqual([]);
      await rulesOn();
      const swept = await identify({ only: [w.slug] });
      expect(swept.lines.some((l) => /^- applied [1-9]\d* of [1-9]\d*$/.test(l))).toBe(true);
      expect(await identifiers(w.id)).toEqual(["open_library OL157104W", "wikidata Q979609"]);
    });

    it("undoes a run: identifiers and the LCCN column go back, its unapplied proposals are withdrawn, and undone values wait for Pablo", async () => {
      await rulesOn();
      const w = await identityBook("2666, undone", "9780374100148");
      const runId = randomUUID();
      await identify({ runId, only: [w.slug] });
      expect(await identifiers(w.id, w.editionId)).toEqual(["lccn 2009290464", "open_library OL712025W"]);
      const undone = await undoRun(conn, { runId, apply: true });
      expect(undone.refused).toEqual([]);
      expect(undone.lines).toContain("Identity: withdrew 1 proposals the run made and never applied");
      expect(await identifiers(w.id, w.editionId)).toEqual([]);
      expect((await c`select lccn from editions where id = ${w.editionId}`)[0].lccn).toBeNull();
      expect((await claimsOf(w.id)).map((x) => [x.key, x.status, x.decision_reason])).toEqual([
        ["lccn", "proposed", null],
        ["open_library_work", "proposed", null],
        ["wikidata_qid", "rejected", "run_undone"],
      ]);
      // The sweep never applies an undone value again
      const next = await identify({ only: [w.slug] });
      expect(await identifiers(w.id, w.editionId)).toEqual([]);
      expect(next.lines.join("\n")).toMatch(new RegExp(`## Undone, waiting for Pablo \\(\\d+\\)\\n(- .*\\n)*- ${w.slug}: lccn of 9780374100148 2009290464`));
    });

    it("applies the review file: accepts, rejects and records Pablo's own value with its note; a QID accepted there re-queues the book", async () => {
      const bolano = await identityBook("2666, reviewed", "9780374100148");
      const kaputt = await identityBook("Kaputt", "9781590171479");
      await identify({ only: [bolano.slug, kaputt.slug] });
      const review: Record<string, IdentityReviewEntry> = {
        [bolano.slug]: { title: "2666, reviewed", wikidata_qid: "Q219437", lccn: { "9780374100148": null }, note: "Bolaño's novel; Wikidata's P648 names another Open Library record" },
        [kaputt.slug]: { title: "Kaputt", wikidata_qid: KAPUTT_HIT.id, oclc_work: "123456", note: "Malaparte's Kaputt" },
      };
      const stages = { identity: identityStage(review) as EnrichmentStage };
      const runId = randomUUID();
      const applied = await identify({ runId, stages, only: [bolano.slug] });
      expect(applied.lines).toContain(`- ${bolano.slug}: wikidata_qid: accepts the proposal Q219437`);
      expect(applied.lines).toContain(`- ${kaputt.slug}: oclc_work: records Pablo's 123456 (no source confirms it)`);
      expect((await claimsOf(bolano.id)).map((x) => [x.key, x.status, x.decided_by, x.decision_reason])).toEqual([
        ["lccn", "rejected", "pablo", "wrong_book"],
        ["open_library_work", "proposed", null, null],
        ["wikidata_qid", "accepted", "pablo", null],
      ]);
      const notes = await c`select a.note, a.batch_id, c.method from enrichment_applications a join enrichment_claims c on c.id = a.claim_id where a.work_id in (${bolano.id}, ${kaputt.id}) order by c.method, a.note`;
      expect(notes.map((n) => [n.method, n.batch_id, n.note.replace(/\(review [0-9a-f]{12}\)$/, "(review)")])).toEqual([
        ["api", runId, "Bolaño's novel; Wikidata's P648 names another Open Library record (review)"],
        ["human", runId, "Malaparte's Kaputt (review)"],
        ["human", runId, "Malaparte's Kaputt (review)"],
      ]);
      // Pablo's own QID cites the item it was looked up in; his OCLC work ID cites nothing
      expect(
        (await c`select d.key, count(e.id)::int as n from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id
          left join claim_evidence e on e.claim_id = c.id where c.work_id = ${kaputt.id} and c.method = 'human' group by d.key order by d.key`),
      ).toEqual([{ key: "oclc_work", n: 0 }, { key: "wikidata_qid", n: 1 }]);
      expect(await identifiers(kaputt.id)).toEqual(["oclc 123456", "wikidata Q90000002"]);
      // The accepted QID queued the book again; with its rules on, the next run applies the QID's OCLC work ID
      expect(await c`select reason from (select payload ->> 'reason' as reason from enrichment_jobs where work_id = ${bolano.id} and status = 'queued') j`).toEqual([{ reason: "manual" }]);
      await rulesOn();
      await identify({ stages, only: [bolano.slug] });
      expect(await identifiers(bolano.id, bolano.editionId)).toContain("oclc 119792823");
      // An entry applied before is skipped; an unknown slug or another title stops the run
      expect((await identify({ stages })).lines).toContain(`- ${bolano.slug}: applied before; change the entry to apply it again`);
      await expect(identify({ stages: { identity: identityStage({ "no-such-book": { title: "None", wikidata_qid: null, note: "x" } }) as EnrichmentStage } })).rejects.toThrow(
        "Review file: no book has the slug no-such-book",
      );
      await expect(identify({ stages: { identity: identityStage({ [kaputt.slug]: { title: "Kaput", wikidata_qid: null, note: "x" } }) as EnrichmentStage } })).rejects.toThrow(
        `Review file: ${kaputt.slug} is titled "Kaputt", not "Kaput"`,
      );
    });

    it("leaves a placeholder edition to Identify, and writes only an empty LCCN column, never on a locked edition", async () => {
      await rulesOn();
      const placeholder = await identityBook("Life and Fate, placeholder", "9781784871963", { edition: { metadata_source: "phantom_canon" } });
      const kept = await identityBook("The Skin", "9781590176221", { edition: { lccn: "kept-by-hand" } });
      // The same edition again, by its ISBN-10 (an ISBN-13 is unique)
      const locked = await identityBook("The Skin, locked", null, { edition: { isbn_10: "1590176227", metadata_locked: true } });
      const report = await identify({ only: [placeholder.slug, kept.slug, locked.slug] });
      expect(report.jobs.find((j) => j.slug === placeholder.slug)!.outcome).toMatchObject({ result: "not_found", proposed: 0 });
      expect(await c`select id from source_records where work_id = ${placeholder.id} or edition_id = ${placeholder.editionId}`).toEqual([]);
      expect(await identifiers(kept.id, kept.editionId)).toContain("lccn 2012045914");
      expect((await c`select lccn from editions where id = ${kept.editionId}`)[0].lccn).toBe("kept-by-hand");
      expect((await c`select a.after -> 'value' ->> 'column' as kept from enrichment_applications a where a.edition_id = ${kept.editionId}`)[0].kept).toBe("kept-by-hand");
      expect((await claimsOf(locked.id)).some((x) => x.key === "lccn")).toBe(false);
      await expect(createHumanClaim({ workId: locked.id, editionId: locked.editionId, dimension: "lccn", value: { text: "2012045914" } }, conn)).rejects.toThrow(
        "The edition is locked; unlock it first",
      );
    });

    it("turns rules on only with an approval link and only for the named dimensions, never a gated rule, and off at once", async () => {
      const rule = (key: string) =>
        c`select r.enabled, r.approval_url, r.minimum_confidence::float8 as minimum from enrichment_auto_accept_rules r join enrichment_dimensions d on d.id = r.dimension_id where d.key = ${key}`.then((r) => r[0]);
      await expect(enableIdentityRules(conn, { dimensions: ["wikidata_qid"], approvalUrl: undefined, apply: true })).rejects.toThrow("needs --approval");
      await expect(enableIdentityRules(conn, { dimensions: ["tone"], approvalUrl: APPROVAL, apply: true })).rejects.toThrow();
      expect(await enableIdentityRules(conn, { dimensions: ["wikidata_qid"], approvalUrl: APPROVAL, apply: false })).toEqual([
        `Would turn on the exact-match rules of wikidata_qid (approval ${APPROVAL})`,
      ]);
      expect((await rule("wikidata_qid")).enabled).toBe(false);
      await enableIdentityRules(conn, { dimensions: ["wikidata_qid"], approvalUrl: APPROVAL, apply: true });
      expect(await rule("wikidata_qid")).toEqual({ enabled: true, approval_url: APPROVAL, minimum: 1 });
      expect((await rule("lccn")).enabled).toBe(false);
      expect(await rule("tone")).toMatchObject({ enabled: false, approval_url: null });
      expect(await disableIdentityRules(conn, {})).toEqual(["Turned off the exact-match rules of wikidata_qid"]);
      expect((await rule("wikidata_qid")).enabled).toBe(false);
    });

    it("refuses to start the identity stage without a contact", async () => {
      await expect(runWorker(conn, { runId: randomUUID(), worker: "test", kinds: ["identity"], apply: false, cache: recordedAnswers(), contact: null })).rejects.toThrow(
        "The identity stage calls outside services: set ENRICHMENT_CONTACT",
      );
    });
  });
});
