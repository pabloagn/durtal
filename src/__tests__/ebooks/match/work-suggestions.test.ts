import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get() { throw new Error("Global database forbidden"); } }) }));
const state = vi.hoisted(() => ({ loaded: null as unknown, bounds: null as unknown,
  calls: [] as { sql: string; params: unknown[] }[], storedCount: 7, failure: false }));
vi.mock("@/lib/ebooks/match/load", async (actual) => ({ ...await actual<object>(),
  loadMatchCatalogue: async (_conn: unknown, bounds: unknown) => { state.bounds = bounds; return state.loaded; } }));
vi.mock("@/lib/db/atomic", () => ({ atomicOn: async (_conn: unknown, build: (d: unknown) => unknown[]) => {
  const dialect = new PgDialect();state.calls = build(drizzle.mock()).map(query =>
    dialect.sqlToQuery((query as { getSQL(): SQL }).getSQL()));
  if (state.failure) throw new Error("Actual atomic refused");
  return state.calls.map((_query, index) => index === state.calls.length - 1
    ? [{ workId, suggestionCount: state.storedCount, status: "ready" }] : []);
} }));
import { WORK_SUGGESTION_BOUNDS, planSuggestionsForWorkOn, persistWorkSuggestions } from "@/lib/ebooks/match/work-suggestions";
import { type LoadedMatchCatalogue } from "@/lib/ebooks/match/load";
import { hashMatchingPlan } from "@/lib/ebooks/match/plan";
import { catalogue, ebook, work, at } from "./fixtures";
const workId = "10000000-0000-4000-8000-000000000001";
function setup() {
  const pending = ebook(), book = work({ id: workId });
  const loaded: LoadedMatchCatalogue = { catalogue: catalogue({ ebooks: [pending], works: [book] }),
    rows: { editions: [], authors: [], person_aliases: [], work_authors: [],
      catalogue_identifiers: [], series: [], instances: [], app_settings: [], locations: [],
      ebook_files: [], ebook_match_candidates: [], works: [{ id: workId, kind: "book" }],
      ebooks: [{ id: pending.id, match_state: "pending", instance_id: null }] },
    catalogueFingerprint: "a".repeat(64), inputFingerprint: "b".repeat(64) };
  state.loaded = loaded;state.failure = false;state.calls = [];state.storedCount = 7;return loaded;
}
describe("bounded actual-model suggestions for an existing book", () => {
  it("stores relevant pending candidates and returns the actual transaction count without linking", async () => {
    setup();const plan = await planSuggestionsForWorkOn({} as Db, workId, { targetDatabase: "target", now: at });
    expect(state.bounds).toEqual(WORK_SUGGESTION_BOUNDS);
    expect(plan.results).toHaveLength(1);expect(plan.results[0].candidates.some(row => row.workId === workId)).toBe(true);
    expect(plan.results.every(row => !row.autoLink)).toBe(true);expect(plan.restoreIds).toEqual([]);
    expect(await persistWorkSuggestions({} as Db, plan, "target")).toEqual({ workId, suggestionCount: 7, status: "ready" });
    expect(state.calls.at(-1)?.sql).toContain('"suggestionCount"');
    const mutations = state.calls.filter(query => /^(?:insert|update|delete)/.test(query.sql));
    expect(mutations.some(query => query.sql.startsWith('insert into "ebook_match_candidates"'))).toBe(true);
    expect(mutations.some(query => query.sql.includes('"instance_id" =') || query.sql.includes('"match_state" =') ||
      /(?:into|update) "(?:instances|works|editions)"/.test(query.sql))).toBe(false);
    expect(state.calls.findIndex(query => query.sql.includes('Matching snapshot changed'))).toBeLessThan(
      state.calls.findIndex(query => query.sql.startsWith('delete from "ebook_match_candidates"')));
  });
  it("refuses missing/non-book works and excess pending targets before mutation", async () => {
    const loaded = setup();loaded.rows.works = [{ id: workId, kind: "film" }];
    await expect(planSuggestionsForWorkOn({} as Db, workId, { targetDatabase: "target" })).rejects.toThrow('actual existing book');
    loaded.rows.works = [{ id: workId, kind: "book" }];
    loaded.catalogue = catalogue({ works: [work({ id: workId })], ebooks:
      Array.from({ length: WORK_SUGGESTION_BOUNDS.maxPendingEbooks + 1 }, (_, i) => ebook({ id: `pending-${i}` })) });
    await expect(planSuggestionsForWorkOn({} as Db, workId, { targetDatabase: "target" })).rejects.toThrow('bound');
    expect(state.calls).toEqual([]);
  });
  it("rejects auto-link transplants, wrong target/hash and failed final atomic", async () => {
    setup();const plan = await planSuggestionsForWorkOn({} as Db, workId, { targetDatabase: "target", now: at });
    await expect(persistWorkSuggestions({} as Db, plan, "elsewhere")).rejects.toThrow();
    const altered = { ...plan, results: plan.results.map(result => ({ ...result, autoLink: true })) };
    altered.planSha256 = hashMatchingPlan(altered);
    await expect(persistWorkSuggestions({} as Db, altered, "target")).rejects.toThrow('scope');
    expect(state.calls).toEqual([]);state.failure = true;
    await expect(persistWorkSuggestions({} as Db, plan, "target")).rejects.toThrow('Actual atomic refused');
  });
});
