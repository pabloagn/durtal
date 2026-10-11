import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/catalogue/work-store";
import type { IngestPlan, PlanFile, PlanGroup } from "@/lib/ebooks/ingest/plan";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get() { throw new Error("Global database forbidden"); } }),
}));
const state = vi.hoisted(() => ({ loaded: null as LoadedMatchCatalogue | null, reads: 0, allocations: 0, onRead: null as (() => void) | null, writes: [] as string[] }));
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
  loadMatchCatalogue: async () => { state.reads++; const callback = state.onRead; state.onRead = null; callback?.(); return state.loaded; },
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
import { createIngestionMatchingDocument, planIngestionMatchingOn, ingestionMatchingInputHash, ingestionMatchingIsCurrentOn } from "@/lib/ebooks/match/ingest-adapter";
import { planGroupMatching } from "@/lib/ebooks/match/groups";
import { applyApprovedGroups, planApprovedGroupsOn } from "@/lib/ebooks/match/apply-groups";
import { scoreCalibration } from "@/lib/ebooks/match/calibration";
import { matchFingerprint } from "@/lib/ebooks/match/keys";
import { labelMatchingDocument } from "@/lib/ebooks/match/command";
import { clusterGroups } from "@/lib/ebooks/ingest/group-clusters";
import { type LoadedMatchCatalogue } from "@/lib/ebooks/match/load";
import { catalogue, ebook, work, edition, copy, at } from "./fixtures";

function file(path: string, sha256: string, format: PlanFile["format"] = "epub"): PlanFile {
  return {
    path, sha256, format, size: 1000, mtimeMs: 1,
    key: `${sha256}.${format}`, contentType: "application/epub+zip",
    originalFilename: path, downloadName: path, metadata: {}, problem: null, drm: null,
    coverKey: null, manifestKey: null, derived: [],
    text: { wordCount: null, charCount: null, frontBackWordCount: null,
      pageEstimate: null, language: null, toolVersion: 2, reason: null },
  };
}
function group(key: string, path: string, fields: Partial<PlanGroup> = {}): PlanGroup {
  return {
    key, paths: [path], importSource: "folder", importRef: "same-uuid",
    existingEbookId: null, folder: "/inbox", sidecar: null, personalData: false,
    ebook: { title: "Nadja", titleSort: "Nadja", subtitle: null,
      authors: ["Andre Breton"], authorSort: null, language: "en", isbns: [], identifiers: {},
      series: null, seriesIndex: null, publisher: null, publishedYear: null,
      description: null, subjects: [], searchText: "Nadja Andre Breton" },
    ...fields,
  };
}
function plan(groups: PlanGroup[], files: PlanFile[]): IngestPlan {
  state.onRead = null;
  state.loaded = {
    catalogue: catalogue({ works: [] }),
    rows: { works: [], editions: [], authors: [], person_aliases: [], work_authors: [],
      catalogue_identifiers: [], series: [], instances: [], app_settings: [],
      locations: [], ebooks: [], ebook_files: [], ebook_match_candidates: [] },
    catalogueFingerprint: "a".repeat(64), inputFingerprint: "b".repeat(64),
  };
  return {
    v: 1, toolVersion: 2, createdAt: at, host: "source-test",
    roots: ["/inbox"], includeText: false, exclude: [], limit: null,
    target: { database: "target", bucket: "preview", prefix: "ebooks/", preview: true }, groups,
    files: Object.fromEntries(files.map((item) => [item.path, item])),
    items: files.map((item) => ({ path: item.path, size: item.size, mtimeMs: item.mtimeMs,
      sha256: item.sha256, format: item.format, outcome: "new_ebook", reason: null,
      group: groups.findIndex((group) => group.paths.includes(item.path)), duplicateOf: null })),
    summary: { found: files.length, filesByFormat: {}, ebooksToCreate: groups.length,
      formatsToAdd: 0, changed: 0, alreadyStored: 0, alreadyInBucket: 0, duplicates: 0,
      drm: {}, quarantined: [], ignored: {}, personalData: 0, uploadBytes: files.length * 1000,
      uploadObjects: files.length, uploadSpeed: null, estimatedSeconds: null, monthlyCostUsd: 0 },
  };
}
function loadedCatalogue(): LoadedMatchCatalogue {
  if (!state.loaded) throw new Error("Expected a loaded catalogue fixture");
  return state.loaded;
}
const committedRunId = "40000000-0000-4000-8000-000000000001";
const laterRunId = "40000000-0000-4000-8000-000000000002";
/** Execute the shared automatic writer against the mocked transaction and use
 * its produced receipt, rather than inventing the completed run identity. */
async function committedMatching() {
  const input = ebook(), p = plan([group("nadja", "nadja.epub")], [file("nadja.epub", input.files[0].sha256)]);
  const loaded: LoadedMatchCatalogue = {
    ...loadedCatalogue(),
    catalogue: catalogue({ works: [work({ editions: [edition()], copies: [copy()] })] }),
  };
  state.loaded = loaded;
  const matching = await planGroupMatching({} as Db, [{
    groupKey: "nadja", existingEbookId: null,
    metadataFingerprint: matchFingerprint(input), ebook: input,
  }], ingestionMatchingInputHash(p));
  expect(matching.results[0].autoLink).toBe(true);
  const document = createIngestionMatchingDocument(p, {
    plan: matching, precision: scoreCalibration(matching.binding, matching.sample,
      matching.sample.map((row) => ({ ebookId: row.ebookId, fingerprint: row.fingerprint, tier: row.tier!, label: "right" as const }))),
  });
  const registered = ebook({ id: "registered-ebook" });
  loaded.catalogue = catalogue({ ...loaded.catalogue.source, ebooks: [registered] });
  loaded.rows.ebooks = [{ id: registered.id, match_state: "pending", updated_at: at }];
  loaded.rows.ebook_files = registered.files.map((file) => ({ id: file.id, ebook_id: registered.id, sha256: file.sha256, format: file.format }));
  loaded.rows.instances = loaded.catalogue.source.works.flatMap((work) => work.copies.map((copy) => ({
    id: copy.id, edition_id: copy.editionId, location_id: copy.locationId, status: copy.status,
    format: null, file_size_bytes: null, updated_at: copy.updatedAt,
  })));
  const planning = await planApprovedGroupsOn({} as Db, document.approval, [{
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
  return { p: document, loaded, receipt };
}
describe("ingestion matching adapter", () => {
  it("snapshots canonical inputs before the first planning read", async () => {
    const input = plan([group("nadja", "nadja.epub")], [file("nadja.epub", "c".repeat(64))]);
    const originalHash = ingestionMatchingInputHash(input);
    state.onRead = () => { input.host = "changed-during-read"; input.groups[0].ebook.title = "Another book"; };
    const matching = await planIngestionMatchingOn({} as Db, input);
    expect(matching.binding.inputPlanSha256).toBe(originalHash);
    expect(matching.groups[0].title).toBe("Nadja");
    expect(ingestionMatchingInputHash(input)).not.toBe(originalHash);
  });
  it("keeps approval and labels separate from privately frozen ingestion inputs", async () => {
    const { p } = await committedMatching();
    expect("matching" in p.ingestPlan).toBe(false);
    expect(Object.isFrozen(p.ingestPlan.groups[0].ebook)).toBe(true);
    const input = structuredClone(p.ingestPlan), approval = structuredClone(p.approval);
    const copy = createIngestionMatchingDocument(input, approval);
    const beforeHash = ingestionMatchingInputHash(copy.ingestPlan);
    input.target.database = "another-target";
    approval.plan.binding.inputPlanSha256 = "f".repeat(64);
    expect(copy.ingestPlan.target.database).toBe("target");
    expect(copy.approval.plan.binding.inputPlanSha256).toBe(beforeHash);
    expect(() => createIngestionMatchingDocument(input, copy.approval)).toThrow("Matching scope differs");
    const unlabelled = createIngestionMatchingDocument(copy.ingestPlan, { ...copy.approval, precision: null });
    const scored = labelMatchingDocument(unlabelled, copy.approval.plan.sample.map((row) => ({
      ebookId: row.ebookId, fingerprint: row.fingerprint, tier: row.tier!, label: "right" as const,
    })));
    expect(unlabelled.approval.precision).toBeNull();
    expect(scored.approval.precision).not.toBeNull();
    expect(ingestionMatchingInputHash(scored.ingestPlan)).toBe(beforeHash);
    expect(scored.ingestPlan).toEqual(copy.ingestPlan);
  });
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
    await expect(ingestionMatchingIsCurrentOn({} as Db, p, ingestionMatchingInputHash(p.ingestPlan))).rejects.toThrow("Invalid id");
    await expect(ingestionMatchingIsCurrentOn({} as Db, { ...p, ingestPlan: { ...p.ingestPlan, host: "other-host" } }, committedRunId)).rejects.toThrow("Matching scope differs");
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
