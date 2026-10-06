import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";
import type { FetchedPage } from "@/lib/net/safe-fetch-page";
import type { EvidenceObjects } from "@/lib/s3/evidence-objects";

const url = process.env.DURTAL_EVIDENCE_STORE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln468_evidence_store")
    throw new Error("Evidence store tests require disposable local sln468_evidence_store");
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
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), CACHE_TAGS: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import { findStoredPage, readEvidenceText, storeEvidencePage, storeEvidenceText, undoEvidenceRun } from "@/lib/enrichment/evidence-store";
import { evidencePayloadSchema } from "@/lib/enrichment/evidence-payload";
import { applyOutletSeed, loadOutlets } from "@/lib/enrichment/outlet-registry";
import { BudgetStop, metered } from "@/lib/enrichment/meter";
import { claimNextEnrichmentJob, enqueueEnrichmentJob, holdEnrichmentJob } from "@/lib/enrichment/jobs";
import { sourcePayloadHash } from "@/lib/publishers/enrichment";
import { getWorkSourceChoices } from "@/lib/actions/work-relations";
import { keysInUse } from "@/lib/s3/cleanup";
import type { Outlet } from "@/lib/enrichment/outlets";
import type { PriceRow } from "@/lib/enrichment/prices";

/*
 * SLN-468: the evidence store, the outlet registry and the cost meter on
 * PostgreSQL (migration 0078). The bucket is an in-memory stand-in and the
 * fetcher a function: nothing here reaches a network or S3.
 */

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const PAGE_TEXT = "Kaputt is a book of the war seen from the dinner tables of the Axis.";
const PRICES: PriceRow[] = [{ provider: "search", operation: "query", usdPerUnit: { queries: 1 }, source: "https://example.com/prices", readOn: "2026-10-07" }];
const outlet = (over: Partial<Outlet> = {}): Outlet => ({
  key: "lrb",
  name: "London Review of Books",
  domains: ["lrb.co.uk"],
  kind: "review",
  language: "en",
  weight: 0.95,
  syndicationGroup: null,
  fetchPolicy: "fetch",
  termsUrl: null,
  termsCheckedOn: "2026-10-07",
  termsNote: null,
  status: "active",
  ...over,
});

describe.skipIf(!url)("the evidence store", () => {
  const c = client!;
  const database = testDb as unknown as Db;
  const bucket: Record<string, Buffer> = {};
  const objects: EvidenceObjects = {
    putIfMissing: async (key, body) => (key in bucket ? false : ((bucket[key] = body), true)),
    get: async (key) => bucket[key] ?? null,
  };
  let fetches = 0;
  /** A fetcher that answers with the given final URL and text */
  const fetcher = (finalUrl: string, text = PAGE_TEXT) => async (requestedUrl: string): Promise<FetchedPage> => {
    fetches++;
    return {
      requestedUrl,
      finalUrl,
      httpStatus: 200,
      contentType: "text/html",
      charset: "utf-8",
      raw: Buffer.from(`<html><body><p>${text}</p></body></html>`),
      html: `<html><body><p>${text}</p></body></html>`,
      outlet: "lrb",
      robots: { url: "https://www.lrb.co.uk/robots.txt", status: 200, group: "*", rule: null, decision: "allowed", crawlDelay: null, fetchedAt: new Date().toISOString() },
    };
  };
  const extractor = { name: "test", version: "1", extract: (html: string) => ({ text: html.replace(/<[^>]+>/g, ""), title: "A review", byline: null, publishedOn: null, language: "en", canonicalUrl: null }) };
  const store = (owner: Parameters<typeof storeEvidencePage>[0]["owner"], requested: string, finalUrl = requested, more: { refresh?: boolean; runId?: string; text?: string } = {}) =>
    storeEvidencePage({
      database,
      owner,
      url: requested,
      runId: more.runId ?? randomUUID(),
      refresh: more.refresh,
      fetchPage: fetcher(finalUrl, more.text),
      extractor,
      objects,
      outletName: () => "London Review of Books",
    });
  const book = async (title: string, kind = "book") => {
    // Only a book has an original language
    const [w] = await c`insert into works(title, slug, kind, original_language) values (${title}, ${`${title.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 8)}`}, ${kind}, ${kind === "book" ? "en" : null}) returning id`;
    return w.id as string;
  };

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`insert into enrichment_vocabulary_versions(version, approved_at, approval_url, seed_sha256) values (1, now(), 'https://linear.app/sanctum-black/issue/SLN-461#comment-1', ${"a".repeat(64)})`;
    await c`insert into enrichment_dimensions(key, label, definition, introduced_in, layer, value_kind, apply_target) values ('composition_year', 'Composition year', 'A definition.', 1, 'facts', 'number', 'values')`;
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  describe("the outlet registry", () => {
    it("refuses a bad weight, kind or policy, fetch without checked terms, a dotted or reserved key, and a shared domain", async () => {
      await applyOutletSeed(database, [outlet()], 1);
      const insert = (fields: Record<string, unknown>) =>
        c`insert into evidence_outlets ${c({ key: "x", name: "X", domains: ["x.example"], kind: "review", weight: 0.5, fetch_policy: "snippet_only", seed_version: 1, ...fields })}`;
      await expect(insert({ weight: 1.2 })).rejects.toMatchObject({ constraint_name: "evidence_outlet_value_check" });
      await expect(insert({ kind: "blog" })).rejects.toMatchObject({ constraint_name: "evidence_outlet_value_check" });
      await expect(insert({ fetch_policy: "maybe" })).rejects.toMatchObject({ constraint_name: "evidence_outlet_policy_check" });
      await expect(insert({ fetch_policy: "fetch" })).rejects.toMatchObject({ constraint_name: "evidence_outlet_policy_check" });
      await expect(insert({ key: "x.example" })).rejects.toMatchObject({ constraint_name: "evidence_outlet_value_check" });
      await expect(insert({ key: "wikidata" })).rejects.toMatchObject({ constraint_name: "evidence_outlet_value_check" });
      await expect(insert({ domains: ["lrb.co.uk"] })).rejects.toMatchObject({ constraint_name: "evidence_outlet_domains" });
      await expect(insert({ domains: ["Not A Host"] })).rejects.toMatchObject({ constraint_name: "evidence_outlet_domains" });
      await expect(c`delete from evidence_outlets where key = 'lrb'`).rejects.toMatchObject({ constraint_name: "evidence_outlet_identity" });
    });

    it("applies a seed version and retires the outlets that leave it", async () => {
      await applyOutletSeed(database, [outlet(), outlet({ key: "nyrb", name: "NYRB", domains: ["nybooks.com"] })], 2);
      await applyOutletSeed(database, [outlet({ weight: 0.9 })], 3);
      const rows = await loadOutlets(database);
      expect(rows.find((o) => o.key === "lrb")).toMatchObject({ weight: 0.9, status: "active" });
      expect(rows.find((o) => o.key === "nyrb")).toMatchObject({ status: "retired" });
    });
  });

  describe("documents", () => {
    it("stores one accepted row per owner with the payload's hash and no page text, and the text under its hash", async () => {
      const work = await book("Kaputt");
      const { record, fetched } = await store({ kind: "book", workId: work }, "https://www.lrb.co.uk/the-paper/v1/n1/kaputt?utm_source=x");
      expect(fetched).toBe(true);
      expect(record).toMatchObject({ entityKind: "book", workId: work, provider: "lrb", url: "https://www.lrb.co.uk/the-paper/v1/n1/kaputt", reviewStatus: "accepted", attribution: "London Review of Books" });
      expect(record.verifiedAt).toEqual(record.retrievedAt);
      const payload = evidencePayloadSchema.parse(record.payload);
      expect(record.payloadHash).toBe(sourcePayloadHash(record.payload));
      expect(JSON.stringify(record.payload)).not.toContain(PAGE_TEXT);
      expect(payload.textSha256).toBe(sha(PAGE_TEXT));
      expect(await readEvidenceText(payload.textSha256, objects)).toEqual({ status: "ok", value: PAGE_TEXT });
      expect((await keysInUse([payload.textKey, `${payload.textKey}.other`], database)).has(payload.textKey)).toBe(true);
    });

    it("reuses a stored URL for another owner without a fetch, and adds nothing for the same owner", async () => {
      const first = await book("Reuse");
      const second = await book("Reuse two");
      const page = "https://www.lrb.co.uk/the-paper/v2/n2/reuse";
      const original = await store({ kind: "book", workId: first }, page);
      const before = fetches;
      const again = await store({ kind: "book", workId: first }, page);
      expect(again).toMatchObject({ fetched: false, created: false });
      expect(again.record.id).toBe(original.record.id);
      const other = await store({ kind: "book", workId: second }, page);
      expect(other).toMatchObject({ fetched: false, created: true });
      expect(other.record.retrievedAt).toEqual(original.record.retrievedAt);
      // Asked again, the second owner keeps its one row, whichever row the lookup finds first
      for (let i = 0; i < 3; i++) expect(await store({ kind: "book", workId: second }, page)).toMatchObject({ created: false });
      expect(Number((await c`select count(*)::int as n from source_records where work_id = ${second}`)[0].n)).toBe(1);
      expect(fetches).toBe(before);
      expect((await findStoredPage(database, page))?.url).toBe(page);
    });

    it("chains a refresh of the same owner and URL, and starts afresh when the final URL changed", async () => {
      const work = await book("Refresh");
      const page = "https://www.lrb.co.uk/the-paper/v3/n3/refresh";
      const first = await store({ kind: "book", workId: work }, page);
      const refreshed = await store({ kind: "book", workId: work }, page, page, { refresh: true, text: "A revised review." });
      expect(refreshed.record.supersedesId).toBe(first.record.id);
      const moved = await store({ kind: "book", workId: work }, page, `${page}-moved`, { refresh: true });
      expect(moved.record.supersedesId).toBeNull();
      // The old text stays, so an excerpt quoted from it still verifies
      expect(await readEvidenceText((first.record.payload as { textSha256: string }).textSha256, objects)).toMatchObject({ status: "ok" });
    });

    it("stores a snippet with its search provider and query", async () => {
      const work = await book("Snippet");
      const row = await storeEvidenceText({ database, owner: { kind: "book", workId: work }, outlet: "lrb", outletName: "LRB", url: "https://www.lrb.co.uk/x", text: "A snippet.", searchProvider: "search", query: "kaputt review", runId: randomUUID(), objects });
      expect(row.payload).toMatchObject({ kind: "evidence_text", retrievedVia: "search:search", query: "kaputt review", textSha256: sha("A snippet.") });
    });

    it("refuses an owner that is not a book before any fetch or upload", async () => {
      const film = await book("A film", "film");
      const before = { fetches, objects: Object.keys(bucket).length };
      await expect(store({ kind: "book", workId: film }, "https://www.lrb.co.uk/film")).rejects.toThrow(/Book not found/);
      expect({ fetches, objects: Object.keys(bucket).length }).toEqual(before);
    });

    it("undoes a run's uncited rows and keeps the cited ones", async () => {
      const work = await book("Undo");
      const run = randomUUID();
      const cited = await store({ kind: "book", workId: work }, "https://www.lrb.co.uk/undo-cited", undefined, { runId: run });
      await store({ kind: "book", workId: work }, "https://www.lrb.co.uk/undo-free", undefined, { runId: run, text: "Another review." });
      const [dimension] = await c`select id from enrichment_dimensions where key = 'composition_year'`;
      await c.begin(async (tx) => {
        const t = tx as unknown as postgres.Sql;
        const [claim] = await t`insert into enrichment_claims ${t({ work_id: work, dimension_id: dimension.id, number_value: 1943, method: "agent", confidence: 0.8, vocabulary_version: 1, run_id: run })} returning id`;
        await t`insert into claim_evidence(claim_id, source_record_id, outlet, extractor_version, run_id, locator, excerpt, excerpt_sha256, start_offset, end_offset, text_sha256)
          values (${claim.id}, ${cited.record.id}, 'lrb', 'agent-v1', ${run}, 'text', 'Kaputt', ${sha("Kaputt")}, 0, 6, ${sha(PAGE_TEXT)})`;
      });
      const undone = await undoEvidenceRun(database, run);
      expect(undone).toEqual({ deleted: 1, kept: [cited.record.id] });
    });

    it("lists manual citations first in the relation dialog's source picker", async () => {
      const work = await book("Picker");
      const manual = { entry: "manual" };
      await c`insert into source_records(entity_kind, work_id, provider, retrieved_at, payload, payload_hash, review_status) values ('book', ${work}, 'manual', now() - interval '10 years', ${JSON.stringify(manual)}::jsonb, ${sourcePayloadHash(manual)}, 'accepted')`;
      for (let i = 0; i < 101; i++) {
        const payload = { kind: "evidence_text", i };
        await c`insert into source_records(entity_kind, work_id, provider, retrieved_at, payload, payload_hash, review_status) values ('book', ${work}, 'lrb', now(), ${JSON.stringify(payload)}::jsonb, ${sourcePayloadHash(payload)}, 'accepted')`;
      }
      const choices = await getWorkSourceChoices(work);
      expect(choices).toHaveLength(100);
      expect(choices[0].label).toBe("manual");
    });
  });

  describe("the cost ledger and the meter", () => {
    it("never deletes a row, never changes a settled one, and keeps book_parent_required on its work", async () => {
      const film = await book("Ledger film", "film");
      await expect(c`insert into enrichment_costs(provider, operation, estimated_units, estimated_cost_usd, price_version, work_id) values ('search', 'query', '{}', 0, 'v', ${film})`).rejects.toThrow();
      const [row] = await c`insert into enrichment_costs(provider, operation, estimated_units, estimated_cost_usd, price_version) values ('search', 'query', '{"queries":1}', 1, 'v') returning id`;
      await c`update enrichment_costs set status = 'settled', units = '{"queries":1}', cost_usd = 1, settled_at = now() where id = ${row.id}`;
      await expect(c`update enrichment_costs set cost_usd = 2 where id = ${row.id}`).rejects.toMatchObject({ constraint_name: "enrichment_cost_ledger" });
      await expect(c`delete from enrichment_costs where id = ${row.id}`).rejects.toMatchObject({ constraint_name: "enrichment_cost_ledger" });
    });

    it("lets only one of two parallel reservations through when together they pass the cap", async () => {
      const capUsd = 10_000 + Number((await c`select coalesce(sum(coalesce(cost_usd, estimated_cost_usd)), 0)::float8 as n from enrichment_costs where status <> 'released'`)[0].n);
      const call = async () => ({ result: "answer", units: { queries: 6000 } });
      const results = await Promise.allSettled([1, 2].map(() => metered({ database, provider: "search", operation: "query", estimate: { queries: 6000 }, prices: PRICES, capUsd }, call)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(BudgetStop) });
    });

    it("stops a run before the call that would pass its limit, and a run limit never raises the cap", async () => {
      const runId = randomUUID();
      let calls = 0;
      const call = async () => ((calls += 1), { result: 1, units: { queries: 1 } });
      const input = { database, provider: "search", operation: "query", estimate: { queries: 1 }, prices: PRICES, runId, runLimitUsd: 1.5, capUsd: 1e9 };
      await metered(input, call);
      await expect(metered(input, call)).rejects.toThrow("Stopped: run limit reached");
      expect(calls).toBe(1);
      const used = Number((await c`select coalesce(sum(coalesce(cost_usd, estimated_cost_usd)), 0)::float8 as n from enrichment_costs where status <> 'released'`)[0].n);
      await expect(metered({ ...input, runId: randomUUID(), runLimitUsd: 1e9, capUsd: used + 0.5 }, call)).rejects.toThrow("Stopped: monthly budget reached");
      expect(calls).toBe(1);
    });

    it("adds a settled cost to its job, and a job stopped by the budget is held without an attempt", async () => {
      const work = await book("Metered job");
      await enqueueEnrichmentJob({ workId: work, kind: "research", reason: "manual" }, database);
      const job = await claimNextEnrichmentJob({ worker: "test", kinds: ["research"], workIds: [work] }, database);
      await metered({ database, provider: "search", operation: "query", estimate: { queries: 2 }, prices: PRICES, capUsd: 1e9, workId: work, jobId: job!.id }, async () => ({ result: 1, units: { queries: 3 } }));
      expect(Number((await c`select cost from enrichment_jobs where id = ${job!.id}`)[0].cost)).toBe(3);
      const stop = await metered({ database, provider: "search", operation: "query", estimate: { queries: 1 }, prices: PRICES, capUsd: 0, workId: work, jobId: job!.id }, async () => ({ result: 1, units: { queries: 1 } })).catch((e) => e);
      expect(stop).toBeInstanceOf(BudgetStop);
      await holdEnrichmentJob({ id: job!.id, worker: "test", reason: "budget" }, database);
      expect((await c`select status, held_reason, attempts from enrichment_jobs where id = ${job!.id}`)[0]).toMatchObject({ status: "held", held_reason: "budget", attempts: 0 });
    });
  });
});
