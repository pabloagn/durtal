import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get() { throw new Error("Global database forbidden"); } }) }));
const state = vi.hoisted(() => ({ loaded: null as unknown, dependencies: null as unknown, dependencyReads: 0 }));
vi.mock("@/lib/ebooks/match/load", async (actual) => ({
  ...(await actual<object>()), loadMatchCatalogue: async () => state.loaded,
}));
vi.mock("@/lib/ebooks/match/dependencies", async (actual) => ({
  ...(await actual<object>()), loadMatchDependencies: async () => { state.dependencyReads++; return state.dependencies; },
}));
import { planUndoLinkOn, reviewedUnlinkCore, undoLink } from "@/lib/ebooks/match/undo";
import type { LoadedMatchCatalogue, StoredRow } from "@/lib/ebooks/match/load";
import { immutableMatchingWriterInput, type LinkReceipt } from "@/lib/ebooks/match/link";
import { hashMatchingPlan } from "@/lib/ebooks/match/plan";
import { prepareMatchAtomicExtension, requireMatchAtomicExtension, type PreparedMatchAtomicExtension } from "@/lib/ebooks/match/review-extension";
import { matchingOperationOf, parseReviewUnlinkPolicy, type ReviewUnlinkPolicy } from "@/lib/ebooks/review/unlink-contract";
import { reviewPayloadHash } from "@/lib/ebooks/review/receipts";
import { reviewOperationSchema } from "@/lib/validations/ebook-review";
import type { MatchOperationIdentity } from "@/lib/ebooks/match/types";
import { catalogue, copy, ebook, edition, work } from "./fixtures";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-10-10T10:00:00.123456Z";
const pgAt = "2026-10-10T10:00:00.123456+00:00";
const operationOf = (operation: MatchOperationIdentity) => reviewOperationSchema.parse({
  version: operation.version, operationId: operation.operationId, runId: operation.runId,
  planSha256: operation.planSha256, targetDatabase: operation.targetDatabase,
});
function scenario(mode: ReviewUnlinkPolicy["mode"] = "unlink", edited = false) {
  const originalBook = { id: id(1), title: "Nadja", created_at: pgAt, updated_at: pgAt,
    matched_at: null, match_state: "linked", match_method: "score", instance_id: id(2),
    match_tier: null, match_fingerprint: null, exclusion_reason: null };
  const instance = { id: id(2), edition_id: id(3), updated_at: pgAt };
  const e = { id: id(3), work_id: id(4) }, w = { id: id(4), kind: "book" };
  const receipt: LinkReceipt = { version: 1, operationId: id(5), runId: id(6), planSha256: "a".repeat(64),
    targetDatabase: "target", kind: "link", ebookId: id(1), instanceId: id(2), editionId: id(3), workId: id(4),
    createdInstance: false, createdEdition: false, workCreated: false, movedFromEditionId: null,
    authorIdsCreated: [], seriesIdCreated: null, historyIdsCreated: [], activityIdsCreated: [],
    before: { ebook: { ...originalBook, match_state: "pending", instance_id: null }, instance, candidates: [] },
    after: { ebook: originalBook, instance, edition: e, work: w, authors: [], series: null, histories: [], activities: [], ownedChildren: {} } };
  const current: StoredRow = { ...originalBook, ...(edited ? { title: "Owner edit" } : {}), link_written: receipt };
  const rows: LoadedMatchCatalogue["rows"] = {
    works: [], editions: [], authors: [], person_aliases: [], work_authors: [],
    catalogue_identifiers: [], series: [], instances: [], app_settings: [],
    locations: [], ebooks: [], ebook_files: [], ebook_match_candidates: [],
  };
  rows.ebooks = [current]; rows.instances = [instance]; rows.editions = [e]; rows.works = [w];
  const loaded: LoadedMatchCatalogue = { rows, catalogue: catalogue({
    ebooks: [ebook({ id: id(1), instanceId: id(2), matchState: "linked" })],
    works: [work({ id: id(4), editions: [edition({ id: id(3), workId: id(4) })],
      copies: [copy({ id: id(2), editionId: id(3), linkedEbookId: id(1) })] })],
  }), catalogueFingerprint: "b".repeat(64), inputFingerprint: "c".repeat(64) };
  state.loaded = loaded; state.dependencies = { references: [], rows: {} }; state.dependencyReads = 0;
  const text = JSON.stringify({ ...current, created_at: at, updated_at: at });
  const matchingAfter = JSON.stringify({ ...originalBook, created_at: at, updated_at: at });
  const stamp = { matchState: "linked" as const, matchTier: null, matchFingerprint: null, updatedAt: at,
    instanceId: id(2), exclusionReason: null, candidatesHash: reviewPayloadHash([]) };
  const policy: ReviewUnlinkPolicy = { version: 1, purpose: "unlink_decision", mode, ebookId: id(1),
    originalMatchingOperation: matchingOperationOf(receipt), expectedCurrent: stamp,
    rawEbookSnapshotText: text, matchingAfterEbookText: matchingAfter };
  let reads = 0;
  const evidence = { text, stamp: { ...stamp }, valid: true, row: current };
  const after = { text: matchingAfter, valid: true };
  const conn = { execute: vi.fn(async () => ++reads === 1 ? [evidence] : [after]) } as unknown as Db;
  return { receipt, loaded, policy, conn, evidence, after };
}
function builders() {
  return { extraTables: ["activity_events"], before: (d: Db) => [d.execute(sql`select ${"review before"}`)],
    after: (d: Db) => [d.execute(sql`select ${"terminal receipt"}`)] };
}
describe("reviewed native unlink policy", () => {
  it("exposes the actual typed core port and binds a new review operation to one exact policy", async () => {
    const s = scenario("automatic_undo");
    const result = await reviewedUnlinkCore.planOn(s.conn, s.receipt, "target", at, { reviewUnlink: s.policy });
    if (result.kind !== "planned") throw new Error("Expected reviewed plan");
    expect(result.plan.reviewUnlink).toEqual(s.policy);
    expect(result.plan.planSha256).toBe(hashMatchingPlan(result.plan));
    expect(result.plan.operationId).not.toBe(s.receipt.operationId);
    expect(s.conn.execute).toHaveBeenCalledTimes(2);
    const binding = { coreWriter: "undo_link" as const, coreOperation: result.plan, ebookIds: [id(1)],
      reviewOperations: [operationOf(result.plan)], purpose: "decision" as const, reviewUnlink: s.policy };
    const extension = prepareMatchAtomicExtension(binding, builders());
    const expected = { coreWriter: "undo_link" as const, coreOperation: result.plan, ebookIds: [id(1)], reviewUnlink: s.policy };
    expect(requireMatchAtomicExtension(extension, expected)).toBe(extension);
    expect(() => requireMatchAtomicExtension(undefined, expected)).toThrow("requires");
    expect(() => requireMatchAtomicExtension({ ...extension } as PreparedMatchAtomicExtension, expected)).toThrow("Untrusted");
    expect(() => requireMatchAtomicExtension(extension, { ...expected, reviewUnlink: undefined })).toThrow();
    expect(() => requireMatchAtomicExtension(extension, { ...expected, reviewUnlink: { ...s.policy, mode: "unlink" } })).toThrow();
    for (const change of [{ reviewUnlink: undefined }, { coreWriter: "link" as const },
      { ebookIds: [id(20)] }, { reviewOperations: [{ ...operationOf(result.plan), planSha256: "d".repeat(64) }] },
      { reviewOperations: [s.policy.originalMatchingOperation] }])
      expect(() => prepareMatchAtomicExtension({ ...binding, ...change }, builders())).toThrow();
  });
  it("rejects later automatic metadata and manual methods before dependency inspection", async () => {
    const s = scenario("automatic_undo", true);
    await expect(planUndoLinkOn(s.conn, s.receipt, "target", at, { reviewUnlink: s.policy })).rejects.toThrow("later eBook change");
    expect(state.dependencyReads).toBe(0); expect(s.conn.execute).not.toHaveBeenCalled();
    const raw = JSON.parse(s.policy.rawEbookSnapshotText); raw.title = "Nadja"; raw.match_method = "manual";
    expect(() => parseReviewUnlinkPolicy({ ...s.policy, rawEbookSnapshotText: JSON.stringify(raw) })).toThrow();
  });
  it.each(["raw", "stamp", "after", "catalogue", "invalid-time"])("checks actual %s evidence before cleanup", async (variant) => {
    const s = scenario();
    if (variant === "raw") s.evidence.text += " ";
    if (variant === "stamp") s.evidence.stamp.updatedAt = "2026-10-10T10:00:00.123457Z";
    if (variant === "after") s.after.text += " ";
    if (variant === "catalogue") s.evidence.row = { ...s.evidence.row, title: "Changed catalogue" };
    if (variant === "invalid-time") s.evidence.valid = false;
    await expect(planUndoLinkOn(s.conn, s.receipt, "target", at, { reviewUnlink: s.policy })).rejects.toThrow("changed");
    expect(state.dependencyReads).toBe(0);
  });
  it("keeps a missing or later native operation unchanged and rejects mixed purposes", async () => {
    const s = scenario(); s.loaded.rows.ebooks = [];
    expect(await planUndoLinkOn(s.conn, s.receipt, "target", at, { reviewUnlink: s.policy })).toEqual({ kind: "unchanged", reason: "missing_or_later_operation" });
    expect(state.dependencyReads).toBe(0);
    await expect(planUndoLinkOn(s.conn, s.receipt, "target", at, { reviewUnlink: s.policy,
      reviewCompensation: {} as never })).rejects.toThrow("mutually exclusive");
  });
  it.each(["edited", "referenced"])("allows fresh metadata but keeps %s owned copies", async (reason) => {
    const s = scenario("unlink", true);
    s.receipt.createdInstance = true;
    if (reason === "edited") s.loaded.rows.instances = [{ ...s.receipt.after!.instance, notes: "Owner edit" }];
    else state.dependencies = { references: [{ parentTable: "instances", childTable: "a_future_table",
      parentColumns: ["id"], childColumns: ["instance_id"] }],
      rows: { a_future_table: [{ id: id(30), instance_id: id(2) }] } };
    // Rebuild actual native receipt text after setting its operation-owned marker.
    s.policy.rawEbookSnapshotText = JSON.stringify({ ...s.loaded.rows.ebooks[0], created_at: at, updated_at: at });
    s.evidence.text = s.policy.rawEbookSnapshotText;
    const result = await planUndoLinkOn(s.conn, s.receipt, "target", at, { reviewUnlink: s.policy });
    if (result.kind !== "planned") throw new Error("Expected reviewed plan");
    expect(result.plan.cleanup.deleted.instances).toEqual([]);
    expect(result.plan.cleanup.retained).toContainEqual(expect.objectContaining({ table: "instances", reason }));
  });
  it("takes a private policy copy before the first planning await", async () => {
    const s = scenario("unlink", true);
    const planning = planUndoLinkOn(s.conn, s.receipt, "target", at, { reviewUnlink: s.policy });
    s.policy.mode = "automatic_undo";
    const result = await planning;
    if (result.kind !== "planned") throw new Error("Expected reviewed plan");
    expect(result.plan.reviewUnlink.mode).toBe("unlink");
    expect(Object.isFrozen(result.plan.reviewUnlink)).toBe(true);
    expect(Object.isFrozen(result.plan.reviewUnlink.originalMatchingOperation)).toBe(true);
  });
  it("guards before changes, advances time once and awaits the real batch's terminal results", async () => {
    const s = scenario("unlink", true);
    const result = await reviewedUnlinkCore.planOn(s.conn, s.receipt, "target", at, { reviewUnlink: s.policy });
    if (result.kind !== "planned") throw new Error("Expected reviewed plan");
    const extension = prepareMatchAtomicExtension({ coreWriter: "undo_link", coreOperation: result.plan,
      ebookIds: [id(1)], reviewOperations: [operationOf(result.plan)], purpose: "decision", reviewUnlink: s.policy }, builders());
    const compiled: { sql: string; params: unknown[] }[] = [], dialect = new PgDialect();
    const returned = [{ terminal: "actual receipt" }];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const conn = Object.assign(drizzle.mock(), { batch: async (queries: unknown[]) => {
      compiled.push(...queries.map((query) => dialect.sqlToQuery((query as { getSQL(): SQL }).getSQL())));
      await pending; return returned;
    } }) as unknown as Db;
    let finished = false;
    const writing = reviewedUnlinkCore.write(conn, result.plan, "target", { atomicExtension: extension }).then((rows) => { finished = true; return rows; });
    await Promise.resolve(); expect(finished).toBe(false);
    expect(compiled[0].sql).toContain("lock table");
    const policyGuard = compiled.findIndex((query) => query.params.includes(s.policy.rawEbookSnapshotText));
    const firstDelete = compiled.findIndex((query) => query.sql.startsWith("delete"));
    expect(policyGuard).toBeGreaterThan(0); expect(policyGuard).toBeLessThan(firstDelete);
    expect(compiled.filter((query) => query.sql.includes('"updated_at" ='))).toHaveLength(1);
    expect(compiled.find((query) => query.sql.includes('"updated_at" ='))?.sql).toContain("greatest(clock_timestamp(),updated_at+interval '1 microsecond')");
    expect(compiled.at(-1)?.params).toEqual(["terminal receipt"]);
    release(); expect(await writing).toBe(returned);
    const changed = { ...result.plan, reviewUnlink: { ...s.policy, mode: "automatic_undo" as const } };
    changed.planSha256 = hashMatchingPlan(changed);
    await expect(undoLink(conn, changed, "target", { atomicExtension: extension })).rejects.toThrow();
    const changedReceipt = { ...result.plan, receipt: { ...result.plan.receipt, instanceId: id(20) } };
    changedReceipt.planSha256 = hashMatchingPlan(changedReceipt);
    const mismatched = prepareMatchAtomicExtension({ coreWriter: "undo_link", coreOperation: changedReceipt,
      ebookIds: [id(1)], reviewOperations: [operationOf(changedReceipt)], purpose: "decision", reviewUnlink: s.policy }, builders());
    await expect(undoLink(conn, changedReceipt, "target", { atomicExtension: mismatched })).rejects.toThrow("original matching operation");
    expect(immutableMatchingWriterInput(result.plan)).toEqual(result.plan);
  });
  it("propagates the atomic receipt suffix failure", async () => {
    const s = scenario();
    const result = await planUndoLinkOn(s.conn, s.receipt, "target", at, { reviewUnlink: s.policy });
    if (result.kind !== "planned") throw new Error("Expected reviewed plan");
    const extension = prepareMatchAtomicExtension({ coreWriter: "undo_link", coreOperation: result.plan,
      ebookIds: [id(1)], reviewOperations: [operationOf(result.plan)], purpose: "decision", reviewUnlink: s.policy }, builders());
    const failure = new Error("terminal receipt rejected");
    const conn = Object.assign(drizzle.mock(), { batch: async () => { throw failure; } }) as unknown as Db;
    await expect(undoLink(conn, result.plan, "target", { atomicExtension: extension })).rejects.toBe(failure);
  });
});
