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
import { enqueueEnrichmentJob } from "@/lib/enrichment/jobs";
import { applyClaim, proposeClaims } from "@/lib/enrichment/claims";
import { applyVocabulary } from "@/lib/enrichment/loader";
import { vocabularySeedSchema } from "@/lib/validations/enrichment";
import { createWork } from "@/lib/actions/works";

/*
 * SLN-464: the enrichment worker and the new-book queue, with a stub stage
 * (the identity stage comes with the second PR). No network.
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
  };
  const stage: EnrichmentStage<{ title: string }> = {
    kind: "identity",
    callsOut: true,
    async fetch(_conn, jobs, ctx) {
      for (const [i, job] of jobs.entries()) {
        if (ctx.cache.get(`work:${job.workId}`)) continue;
        if (stub.refuseAfter !== null && i >= stub.refuseAfter) throw new QuotaStop("The source refused a call (HTTP 429)");
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
    Object.assign(stub, { refuseAfter: null, during: null, writing: null });
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
    expect(stopped.lines[0]).toMatch(/^Stopped after 0 of 2 jobs/);
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
    expect((await undoRun(conn, { runId, apply: false, stages: { identity: stage as EnrichmentStage } })).lines[0]).toBe(`Run ${runId}: 2 applies to undo`);
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
});
