import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Db } from "@/lib/catalogue/work-store";
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get() { throw new Error("Global database forbidden"); } }) }));
import { atomicOn } from "@/lib/db/atomic";
import { snapshotGuardQueries } from "@/lib/ebooks/match/guards";
import { MATCH_TABLES, type LoadedMatchCatalogue } from "@/lib/ebooks/match/load";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  prepareMatchAtomicExtension, requireMatchAtomicExtension, parseReviewCompensation,
  type MatchAtomicBinding, type PreparedMatchAtomicExtension,
} from "@/lib/ebooks/match/review-extension";
import { reviewUndoOperationId } from "@/lib/ebooks/review/receipts";
const operation = { version: 1 as const, operationId: "10000000-0000-4000-8000-000000000001",
  runId: "20000000-0000-4000-8000-000000000001", planSha256: "a".repeat(64), targetDatabase: "target" };
const ebookId = "30000000-0000-4000-8000-000000000001";
function binding(): MatchAtomicBinding {
  return { coreWriter: "link", coreOperation: operation, ebookIds: [ebookId],
    reviewOperations: [operation], purpose: "decision" };
}
const builders = { extraTables: ["activity_events"], before: (d: Db) => [d.execute(sql`select 'review before'`)],
  after: (d: Db) => [d.execute(sql`select 'review after'`)] };
describe("internal prepared review capabilities", () => {
  it("refuses JSON copies, raw objects, copied brands and every mismatched binding", () => {
    const input = binding(), extension = prepareMatchAtomicExtension(input, builders);
    (input as { ebookIds: readonly string[] }).ebookIds = ["40000000-0000-4000-8000-000000000001"];
    const expected = { coreWriter: "link" as const, coreOperation: operation, ebookIds: [ebookId] };
    expect(requireMatchAtomicExtension(extension, expected)).toBe(extension);
    for (const copy of [{ ...extension }, JSON.parse(JSON.stringify(extension)), builders])
      expect(() => requireMatchAtomicExtension(copy as PreparedMatchAtomicExtension, expected)).toThrow("Untrusted");
    for (const changed of [
      { coreWriter: "accession" as const }, { ebookIds: ["40000000-0000-4000-8000-000000000001"] },
      ...["planSha256", "targetDatabase", "operationId", "runId"].map((key) => ({ coreOperation: {
        ...operation, [key]: key === "planSha256" ? "b".repeat(64) : key === "targetDatabase" ? "another" : "50000000-0000-4000-8000-000000000001",
      } })),
    ]) expect(() => requireMatchAtomicExtension(extension, { ...expected, ...changed })).toThrow();
  });
  it("rejects async outer builders and unsupported tables while allowing thenable query objects", () => {
    expect(() => prepareMatchAtomicExtension(binding(), { ...builders, extraTables: ["ebooks"] })).toThrow();
    expect(() => prepareMatchAtomicExtension(binding(), { ...builders,
      before: (async () => []) as unknown as typeof builders.before })).toThrow("synchronous");
    const extension = prepareMatchAtomicExtension(binding(), { ...builders,
      before: (() => Promise.resolve([])) as unknown as typeof builders.before });
    expect(() => extension.before({} as Db)).toThrow("synchronously");
    const good = prepareMatchAtomicExtension(binding(), builders);
    expect(good.before(drizzle.mock() as unknown as Db)).toHaveLength(1);
  });
  it("binds deterministic compensation and keeps core and original plan hashes distinct", () => {
    const policy = parseReviewCompensation({ originalOperation: operation,
      compensationOperationId: reviewUndoOperationId(operation), originalAfterUpdatedAt: "2026-10-10T10:00:00.123456Z" });
    const core = { ...operation, operationId: "60000000-0000-4000-8000-000000000001", planSha256: "c".repeat(64) };
    const extension = prepareMatchAtomicExtension({ ...binding(), coreWriter: "undo_link", coreOperation: core,
      purpose: "compensation", compensation: policy,
      reviewOperations: [{ ...operation, operationId: policy.compensationOperationId }] }, builders);
    const expected = { coreWriter: "undo_link" as const, coreOperation: core, ebookIds: [ebookId], compensation: policy };
    expect(requireMatchAtomicExtension(extension, expected)).toBe(extension);
    expect(() => requireMatchAtomicExtension(undefined, expected)).toThrow("requires");
    expect(() => requireMatchAtomicExtension(extension, { ...expected, compensation: undefined })).toThrow();
    expect(() => requireMatchAtomicExtension(extension, { ...expected, compensation: {
      ...policy, originalAfterUpdatedAt: "2026-10-10T10:00:00.123457Z",
    } })).toThrow();
    for (const change of [{ compensationOperationId: core.operationId }, { originalAfterUpdatedAt: "2026-10-10T10:00:00.123Z" }])
      expect(() => parseReviewCompensation({ ...policy, ...change })).toThrow();
  });
  it("locks the sorted complete union once before core and additional raw assertions", () => {
    const d = drizzle.mock() as unknown as Db, dialect = new PgDialect();
    const snapshot: Pick<LoadedMatchCatalogue, "rows"> = { rows: {
      works: [], editions: [], authors: [], person_aliases: [], work_authors: [],
      catalogue_identifiers: [], series: [], instances: [], app_settings: [],
      locations: [], ebooks: [], ebook_files: [], ebook_match_candidates: [],
    } };
    const queries = snapshotGuardQueries(d, snapshot, ["activity_events", "readings", "activity_events"], { sub_locations: [] });
    const rendered = queries.map((query) => dialect.sqlToQuery((query as { getSQL(): ReturnType<typeof sql> }).getSQL()).sql);
    const names = [...new Set([...MATCH_TABLES, "activity_events", "readings", "sub_locations"])].sort();
    expect(rendered[0]).toBe(`lock table ${names.map((name) => `"${name}"`).join(", ")} in share row exclusive mode`);
    expect(rendered.filter((query) => query.includes("lock table"))).toHaveLength(1);
    expect(rendered.at(-1)).toContain('from "sub_locations"');
    expect(() => snapshotGuardQueries(d, snapshot, [], { ebooks: [] } as never)).toThrow("Unsupported");
  });
  it.each(["batch", "local"] as const)("awaits the same before/core/final suffix in the real atomicOn %s branch", async (branch) => {
    const issued = prepareMatchAtomicExtension(binding(), {
      extraTables: ["activity_events"], before: () => [query("before")], after: () => [query("after")],
    });
    const seen: string[] = [];
    function query(label: string) {
      return { label, then: (resolve: (value: unknown) => unknown, reject: (reason: Error) => unknown) => {
        seen.push(label); return label === "after" ? Promise.reject(new Error("final assertion failed")).then(resolve, reject) : Promise.resolve(label).then(resolve, reject);
      } };
    }
    const conn = {
      ...(branch === "batch" ? { batch: async (queries: unknown[]) => {
        const results = []; for (const item of queries) results.push(await item); return results;
      } } : {}),
      transaction: async (run: (d: Db) => unknown) => run(conn as unknown as Db),
    };
    await expect(atomicOn(conn as unknown as Db, (d) => [
      ...issued.before(d), query("core"), ...issued.after(d),
    ])).rejects.toThrow("final assertion failed");
    expect(seen).toEqual(["before", "core", "after"]);
  });
});
