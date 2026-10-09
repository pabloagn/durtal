import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/catalogue/work-store";
import type { IngestPlan, PlanFile, PlanGroup } from "@/lib/ebooks/ingest/plan";
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get() { throw new Error("Global database forbidden"); } }),
}));
const state = vi.hoisted(() => ({ loaded: null as unknown }));
vi.mock("@/lib/ebooks/match/load", async (importActual) => ({
  ...(await importActual<object>()),
  loadMatchCatalogue: async () => state.loaded,
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
import { planIngestionMatchingOn, ingestionMatchingInputHash } from "@/lib/ebooks/match/ingest-adapter";
import { clusterGroups } from "@/lib/ebooks/ingest/group-clusters";
import { MATCH_TABLES } from "@/lib/ebooks/match/load";
import { catalogue, at } from "./fixtures";

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
describe("ingestion matching adapter", () => {
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
