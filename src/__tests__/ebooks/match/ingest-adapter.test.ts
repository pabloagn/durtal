import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/catalogue/work-store";
import type { IngestPlan, PlanFile, PlanGroup } from "@/lib/ebooks/ingest/plan";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get() { throw new Error("Global database forbidden"); } }),
}));
const state = vi.hoisted(() => ({ loaded: null as unknown, reads: 0, allocations: 0, writes: [] as string[] }));
vi.mock("node:crypto", async (importActual) => {
  const actual = await importActual<typeof import("node:crypto")>();
  return { ...actual, randomUUID: () => { state.allocations++; return actual.randomUUID(); } };
});
vi.mock("@/lib/db/atomic", () => ({
  atomicOn: async (_conn: unknown, build: (conn: unknown) => unknown[]) => {
    const dialect = new PgDialect();
    state.writes.push(...build(drizzle.mock()).map((query) => dialect.sqlToQuery((query as { getSQL(): SQL }).getSQL()).sql));
    return [];
  },
}));
vi.mock("@/lib/ebooks/match/load", async (importActual) => ({
  ...(await importActual<object>()),
  loadMatchCatalogue: async () => { state.reads++; return state.loaded; },
  matchFileFromStoredRow: (row: Record<string, unknown>) => ({
    id: row.id, sha256: row.sha256, format: row.format,
    sizeBytes: row.size_bytes, status: row.status, drm: null,
    availability: row.status === "replaced" ? "blocked" : "native",
  }),
}));
vi.mock("@/lib/ebooks/ingest/register", async (importActual) => ({
  ...(await importActual<object>()),
  readGroupCatalogue: async () => ({ bySha: new Map(), ebook: null }),
}));
import { planIngestionMatchingOn, ingestionMatchingInputHash, ingestionMatchingIsCurrentOn } from "@/lib/ebooks/match/ingest-adapter";
import { planGroupMatching } from "@/lib/ebooks/match/groups";
import { applyApprovedGroups, planApprovedGroupsOn } from "@/lib/ebooks/match/apply-groups";
import { scoreCalibration } from "@/lib/ebooks/match/calibration";
import { matchFingerprint } from "@/lib/ebooks/match/keys";
import { clusterGroups } from "@/lib/ebooks/ingest/group-clusters";
import { MATCH_TABLES, type LoadedMatchCatalogue } from "@/lib/ebooks/match/load";
import { catalogue, ebook, work, edition, copy, at } from "./fixtures";

function file(path: string, sha256: string, format = "epub"): PlanFile {
  return {
    path, sha256, format, size: 1000, mtimeMs: 1,
    key: `${sha256}.${format}`, contentType: "application/epub+zip",
    originalFilename: path, metadata: {}, problem: null, drm: null,
    coverKey: null, manifestKey: null,
    text: { wordCount: null, charCount: null, frontBackWordCount: null,
      pageEstimate: null, language: null, toolVersion: null },
  } as unknown as PlanFile;
}
function group(key: string, path: string, fields: Partial<PlanGroup> = {}): PlanGroup {
  return {
    key, paths: [path], importSource: "folder", importRef: "same-uuid",
    existingEbookId: null,
    ebook: { title: "Nadja", authors: ["Andre Breton"], language: "en", isbns: [], identifiers: {} },
    ...fields,
  } as unknown as PlanGroup;
}
function plan(groups: PlanGroup[], files: PlanFile[]): IngestPlan {
  state.loaded = {
    catalogue: catalogue({ works: [] }),
    rows: Object.fromEntries(MATCH_TABLES.map((table) => [table, []])),
    catalogueFingerprint: "a".repeat(64), inputFingerprint: "b".repeat(64),
  };
  return {
    v: 1, toolVersion: 3, createdAt: at, host: "source-test",
    target: { database: "target" }, groups,
    files: Object.fromEntries(files.map((item) => [item.path, item])),
  } as unknown as IngestPlan;
}
const committedRunId = "40000000-0000-4000-8000-000000000001";
const laterRunId = "40000000-0000-4000-8000-000000000002";
/** Execute the shared automatic writer against the mocked transaction and use
 * its produced receipt, rather than inventing the completed run identity. */
async function committedMatching() {
  const input = ebook(), p = plan([group("nadja", "nadja.epub")], [file("nadja.epub", input.files[0].sha256)]);
  const loaded: LoadedMatchCatalogue = {
    ...(state.loaded as LoadedMatchCatalogue),
    catalogue: catalogue({ works: [work({ editions: [edition()], copies: [copy()] })] }),
  };
  state.loaded = loaded;
  const matching = await planGroupMatching({} as Db, [{
    groupKey: "nadja", existingEbookId: null,
    metadataFingerprint: matchFingerprint(input), ebook: input,
  }], ingestionMatchingInputHash(p));
  expect(matching.results[0].autoLink).toBe(true);
  p.matching = { plan: matching, precision: scoreCalibration(matching.binding, matching.sample,
    matching.sample.map((row) => ({ ebookId: row.ebookId, fingerprint: row.fingerprint, tier: row.tier!, label: "right" as const }))) };
  const registered = ebook({ id: "registered-ebook" });
  loaded.catalogue = catalogue({ ...loaded.catalogue.source, ebooks: [registered] });
  loaded.rows.ebooks = [{ id: registered.id, match_state: "pending", updated_at: at }];
  loaded.rows.ebook_files = registered.files.map((file) => ({ id: file.id, ebook_id: registered.id, sha256: file.sha256, format: file.format }));
  const planning = await planApprovedGroupsOn({} as Db, p.matching, [{
    groupKey: "nadja", ebookId: registered.id,
    fileIds: Object.fromEntries(registered.files.map((file) => [file.sha256, file.id])),
  }], { runId: committedRunId, targetDatabase: p.target.database, now: at });
  if (planning.kind !== "planned") throw new Error("Expected automatic matching apply");
  state.writes.length = 0;
  const applied = await applyApprovedGroups({} as Db, planning.plan, p.target.database);
  expect(applied.linked).toBe(1);
  expect(state.writes.some((query) => query.startsWith('update "ebooks"'))).toBe(true);
  const receipt = applied.receipts[0];
  expect(receipt.runId).toBe(committedRunId);
  loaded.catalogue = catalogue({ ...loaded.catalogue.source, ebooks: [{ ...registered, matchState: "linked", instanceId: receipt.instanceId }] });
  loaded.rows.ebooks = [{ ...loaded.rows.ebooks[0], match_state: "linked", instance_id: receipt.instanceId, link_written: receipt }];
  // Own committed catalogue changes remain allowed for same-run currentness.
  loaded.catalogueFingerprint = "d".repeat(64);
  return { p, loaded, receipt };
}
describe("ingestion matching adapter", () => {
  it("proves a committed automatic UUID run current without allocating or writing", async () => {
    const { p } = await committedMatching();
    const before = { writes: [...state.writes], allocations: state.allocations };
    expect(await ingestionMatchingIsCurrentOn({} as Db, p, committedRunId)).toBe(true);
    expect(state.writes).toEqual(before.writes);
    expect(state.allocations).toBe(before.allocations);
  });
  it("refuses a different run and a later operation receipt", async () => {
    const { p, loaded, receipt } = await committedMatching();
    const before = { writes: [...state.writes], allocations: state.allocations };
    await expect(ingestionMatchingIsCurrentOn({} as Db, p, laterRunId)).rejects.toThrow("owner decision");
    loaded.rows.ebooks[0].link_written = { ...receipt, runId: laterRunId };
    await expect(ingestionMatchingIsCurrentOn({} as Db, p, committedRunId)).rejects.toThrow("owner decision");
    loaded.rows.ebooks[0].link_written = { ...receipt, approvedGroupHash: "f".repeat(64) };
    await expect(ingestionMatchingIsCurrentOn({} as Db, p, committedRunId)).rejects.toThrow("owner decision");
    expect(state.writes).toEqual(before.writes);
    expect(state.allocations).toBe(before.allocations);
  });
  it("refuses changed input scope and a scope hash used as run identity before reads", async () => {
    const { p } = await committedMatching();
    state.reads = 0;
    await expect(ingestionMatchingIsCurrentOn({} as Db, p, ingestionMatchingInputHash(p))).rejects.toThrow("Invalid id");
    await expect(ingestionMatchingIsCurrentOn({} as Db, { ...p, host: "other-host" }, committedRunId)).rejects.toThrow("Matching scope differs");
    expect(state.reads).toBe(0);
  });
  it("simulates same-format replacement in ordered aliases before scoring", async () => {
    const p = plan([group("first", "first.epub"), group("second", "second.epub")], [
      file("first.epub", "c".repeat(64)), file("second.epub", "d".repeat(64)),
    ]);
    const matching = await planIngestionMatchingOn({} as Db, p);
    expect(matching.groups).toHaveLength(1);
    expect(matching.groups[0].sourceGroupKeys).toEqual(["first", "second"]);
    expect(matching.groups[0].fileHashes).toHaveLength(2);
    expect(matching.binding.inputPlanSha256).toBe(ingestionMatchingInputHash(p));
    expect(matching.groups[0].metadataFingerprint).toBe(matching.results[0].fingerprint);
    // The classification binds the replacement as a real second file rather
    // than silently retaining two active files from a combined registration.
    const reversed = plan([...p.groups].reverse(), Object.values(p.files));
    const other = await planIngestionMatchingOn({} as Db, reversed);
    expect(other.groups[0].evidenceFingerprint).not.toBe(matching.groups[0].evidenceFingerprint);
  });
  it("recognizes a duplicate checksum once while retaining every source alias", async () => {
    const hash = "c".repeat(64);
    const p = plan([group("first", "first.epub"), group("second", "second.epub")], [
      file("first.epub", hash), file("second.epub", hash),
    ]);
    const matching = await planIngestionMatchingOn({} as Db, p);
    expect(matching.groups[0].fileHashes).toEqual([{ sha256: hash, format: "epub" }]);
    expect(matching.groups[0].sourceGroupKeys).toEqual(["first", "second"]);
  });
  it("uses the registration cluster's transitive ebook/ref identities", () => {
    const first = group("first", "a", { importRef: "ref-1", existingEbookId: "ebook-1" });
    const second = group("second", "b", { importRef: "ref-2", existingEbookId: "ebook-2" });
    const bridge = group("bridge", "c", { importRef: "ref-1", existingEbookId: "ebook-2" });
    expect(clusterGroups([first, second, bridge])).toEqual([[first, second, bridge]]);
    const otherSource = group("other-source", "d", { importSource: "upload", importRef: "ref-1" });
    expect(clusterGroups([first, otherSource])).toHaveLength(2);
  });
});
