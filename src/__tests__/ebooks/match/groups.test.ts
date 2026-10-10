import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/catalogue/work-store";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get() { throw new Error("Global database forbidden"); } }),
}));
const state = vi.hoisted(() => ({ loaded: null as unknown, reads: 0, writes: [] as string[] }));
vi.mock("@/lib/ebooks/match/load", async (importActual) => ({
  ...(await importActual<object>()),
  loadMatchCatalogue: async () => { state.reads++; return state.loaded; },
}));
vi.mock("@/lib/db/atomic", () => ({
  atomicOn: async (_conn: unknown, build: (conn: unknown) => unknown[]) => {
    const dialect = new PgDialect();
    state.writes.push(...build(drizzle.mock()).map((query) => dialect.sqlToQuery((query as { getSQL(): SQL }).getSQL()).sql));
    return [];
  },
}));
import { planGroupMatching, type ApprovedGroupMatching } from "@/lib/ebooks/match/groups";
import { applyApprovedGroups, planApprovedGroupsOn, requireApprovedGroupPlan } from "@/lib/ebooks/match/apply-groups";
import { scoreCalibration } from "@/lib/ebooks/match/calibration";
import { matchFingerprint, titleKeys } from "@/lib/ebooks/match/keys";
import { MATCH_TABLES, dataFingerprint, type LoadedMatchCatalogue } from "@/lib/ebooks/match/load";
import { catalogue, ebook, work, edition, copy, at } from "./fixtures";
import type { MatchEbook } from "@/lib/ebooks/match/types";
import { matchOne } from "@/lib/ebooks/match/tiers";
import { prepareLinkWrite } from "@/lib/ebooks/match/link";
import { hashMatchingPlan } from "@/lib/ebooks/match/plan";

function snapshot(input?: MatchEbook, hasWork = true, external: MatchEbook[] = []): LoadedMatchCatalogue {
  return {
    catalogue: catalogue({
      ebooks: [...(input ? [input] : []), ...external],
      works: hasWork ? [work({ editions: [edition()], copies: [copy()] })] : [],
    }),
    rows: {
      ...Object.fromEntries(MATCH_TABLES.map((table) => [table, []])),
      ebooks: input ? [{ id: input.id, match_state: input.matchState, updated_at: at }] : [],
      instances: hasWork ? [{ id: "copy-1", edition_id: "edition-1", location_id: "ebooks-location",
        status: "available", format: null, file_size_bytes: null, updated_at: at }] : [],
      ebook_files: input ? input.files.map((file) => ({ id: file.id, ebook_id: input.id, sha256: file.sha256, format: file.format })) : [],
    } as unknown as LoadedMatchCatalogue["rows"],
    catalogueFingerprint: "a".repeat(64),
    inputFingerprint: "b".repeat(64),
  };
}
async function approval(hasWork = true, existing?: MatchEbook, external: MatchEbook[] = []): Promise<ApprovedGroupMatching> {
  state.reads = 0;
  state.loaded = snapshot(existing, hasWork, external);
  const input = existing ?? ebook();
  const plan = await planGroupMatching({} as Db, [{
    groupKey: "inbox:nadja",
    metadataFingerprint: matchFingerprint(input),
    existingEbookId: existing?.id ?? null,
    ebook: input,
  }], "c".repeat(64));
  const precision = plan.results.some((result) => result.autoLink)
    ? scoreCalibration(plan.binding, plan.sample, plan.sample.map((row) => ({
        ebookId: row.ebookId,
        fingerprint: row.fingerprint,
        tier: row.tier!,
        label: "right" as const,
      })))
    : null;
  return { plan, precision };
}
const identity = { runId: "run", targetDatabase: "target", now: at };
const registration = (input: MatchEbook) => [{
  groupKey: "inbox:nadja", ebookId: input.id,
  fileIds: Object.fromEntries(input.files.map((file) => [file.sha256, file.id])),
}];

describe("frozen pre-registration matching", () => {
  it.each(["newEdition", "newCopyDraft"] as const)("rejects a rehashed automatic %s intent even with a real fixture approval", async (field) => {
    const approved = await approval(), real = ebook({ id: "registered-ebook" });
    state.loaded = snapshot(real);
    const next = await planApprovedGroupsOn({} as Db, approved, registration(real), identity);
    if (next.kind !== "planned") throw new Error("Expected planned group");
    const link = next.plan.links[0]; link.choices[field] = {}; link.planSha256 = hashMatchingPlan(link);
    state.writes.length = 0;
    await expect(prepareLinkWrite(link, "target", { automaticApproval: approved })).rejects.toThrow("Manual");
    expect(state.writes).toEqual([]);
  });
  it("refuses a differing old fill effect rather than translating the frozen approval", async () => {
    const approved = await approval(), real = ebook({ id: "registered-ebook" }); state.loaded = snapshot(real);
    const next = await planApprovedGroupsOn({} as Db, approved, registration(real), identity);
    if (next.kind !== "planned") throw new Error("Expected planned group");
    const link = next.plan.links[0]; expect(link.effect.filledCopy).toMatchObject({ format: "epub", fileSizeBytes: 1000 });
    link.effect = { ...link.effect, filledCopy: { format: "pdf", fileSizeBytes: 999 } }; link.planSha256 = hashMatchingPlan(link);
    await expect(prepareLinkWrite(link, "target", { automaticApproval: approved })).rejects.toThrow("Frozen fill");
  });
  it("maps temporary group identities to real owned file rows without rescoring effects", async () => {
    const approved = await approval();
    expect(approved.plan.results[0]).toMatchObject({ ebookId: "group:inbox:nadja", autoLink: true });
    const real = ebook({ id: "registered-ebook", files: ebook().files.map((file) => ({ ...file, id: "registered-file" })) });
    state.loaded = snapshot(real);
    const frozen = JSON.stringify(approved);
    const planned = await planApprovedGroupsOn({} as Db, approved, registration(real), identity);
    expect(planned.kind).toBe("planned");
    if (planned.kind !== "planned") throw new Error("Expected planned link");
    expect(planned.plan.links[0].ebook.id).toBe(real.id);
    expect(planned.plan.links[0].effect).toEqual(approved.plan.results[0].candidates[0].effect);
    expect(planned.plan.links[0].snapshot.rows.ebook_files[0].id).toBe("registered-file");
    expect(JSON.parse(JSON.stringify(planned.plan))).toEqual(planned.plan);
    expect(JSON.stringify(approved)).toBe(frozen);
  });
  it("rejects missing labels before reading registration state", async () => {
    const approved = await approval();
    state.reads = 0;
    await expect(planApprovedGroupsOn({} as Db, { ...approved, precision: null }, [], identity)).rejects.toThrow("labelled precision");
    expect(state.reads).toBe(0);
  });
  it("refuses a newly preferred external duplicate before producing matching writes", async () => {
    const approved = await approval(), input = ebook({ id: "registered-ebook" });
    const external = ebook({ id: "external-ebook", files: [
      ...ebook().files.map((file) => ({ ...file, id: "external-epub", sha256: "d".repeat(64) })),
      { ...ebook().files[0], id: "external-pdf", sha256: "e".repeat(64), format: "pdf" },
    ] });
    expect(approved.plan.results[0].autoLink).toBe(true);
    const current = snapshot(input, true, [external]);
    expect(matchOne(input, current.catalogue)).toMatchObject({ tier: "duplicate", duplicateOfId: external.id, autoLink: false });
    state.loaded = current;
    state.writes.length = 0;
    await expect(planApprovedGroupsOn({} as Db, approved, registration(input), identity)).rejects.toThrow("Matching context changed");
    expect(state.writes).toEqual([]);
  });
  it.each(["shared ISBN", "common title"])("refuses changed external %s evidence", async (change) => {
    const isbn = "9780306406157";
    const input = ebook({ isbns: change === "shared ISBN" ? [isbn] : [] });
    const external = ebook({ id: "external-1", title: change === "shared ISBN" ? "Other title" : "Nadja", authors: ["Other Author"], isbns: input.isbns });
    const added = ebook({ id: "external-2", title: change === "shared ISBN" ? "Third title" : "Nadja", authors: ["Third Author"], isbns: input.isbns });
    const approved = await approval(true, input, [external]);
    const before = snapshot(input, true, [external]).catalogue;
    const current = snapshot(input, true, [external, added]);
    if (change === "shared ISBN") {
      expect(before.sharedIsbns.has(isbn)).toBe(false);
      expect(current.catalogue.sharedIsbns.has(isbn)).toBe(true);
    } else {
      const title = titleKeys(input.title).main;
      expect(before.commonTitles.has(title)).toBe(false);
      expect(current.catalogue.commonTitles.has(title)).toBe(true);
    }
    state.loaded = current;
    state.writes.length = 0;
    await expect(planApprovedGroupsOn({} as Db, approved, registration(input), identity)).rejects.toThrow("Matching context changed");
    expect(state.writes).toEqual([]);
  });
  it.each(["decision", "file capability", "duplicate preference"])("binds external %s without changing selected metadata", async (change) => {
    const external = ebook({ id: "external-ebook", title: "Other title" });
    const approved = await approval(true, undefined, [external]);
    const input = ebook({ id: "registered-ebook" });
    state.loaded = snapshot(input, true, [external]);
    expect((await planApprovedGroupsOn({} as Db, approved, registration(input), identity)).kind).toBe("planned");
    const changed = { ...external };
    if (change === "decision") changed.matchState = "excluded";
    if (change === "file capability") changed.files = changed.files.map((file) => ({ ...file, availability: "download" }));
    if (change === "duplicate preference") changed.createdAt = "2026-10-08T00:00:00.000Z";
    state.loaded = snapshot(input, true, [changed]);
    await expect(planApprovedGroupsOn({} as Db, approved, registration(input), identity)).rejects.toThrow("Matching context changed");
  });
  it.each(["metadata", "file-map", "delivery", "catalogue", "decision"])(
    "refuses changed %s instead of selecting another route",
    async (change) => {
      const approved = await approval();
      const input = ebook({ id: "registered-ebook" });
      if (change === "metadata") input.title = "Another book";
      if (change === "delivery") input.files = input.files.map((file) => ({ ...file, availability: "download" }));
      if (change === "decision") input.matchState = "excluded";
      const current = snapshot(input);
      if (change === "catalogue") current.catalogueFingerprint = "d".repeat(64);
      state.loaded = current;
      const mapping = registration(input);
      if (change === "file-map") mapping[0].fileIds[input.files[0].sha256] = "someone-else-file";
      await expect(planApprovedGroupsOn({} as Db, approved, mapping, identity)).rejects.toThrow();
    },
  );
  it("preserves an unchanged zero-candidate classification without a write plan", async () => {
    const approved = await approval(false), input = ebook({ id: "registered-ebook" });
    const current = snapshot(input, false), result = approved.plan.results[0];
    current.rows.ebooks = [{
      ...current.rows.ebooks[0], match_tier: result.tier,
      match_fingerprint: result.fingerprint, match_model_version: result.modelVersion,
      duplicate_of_id: result.duplicateOfId,
    }];
    state.loaded = current;
    expect(await planApprovedGroupsOn({} as Db, approved, registration(input), identity)).toEqual({ kind: "unchanged", linked: 0, preserved: 1 });
    current.rows.ebooks[0].match_model_version = null;
    expect((await planApprovedGroupsOn({} as Db, approved, registration(input), identity)).kind).toBe("planned");
  });
  it("guards classification atomically and keeps the ingestion timestamp for derived review state", async () => {
    const approved = await approval(false), input = ebook({ id: "registered-ebook" });
    state.loaded = snapshot(input, false);
    const planned = await planApprovedGroupsOn({} as Db, approved, registration(input), identity);
    if (planned.kind !== "planned") throw new Error("Expected classification plan");
    state.writes.length = 0;
    const result = await applyApprovedGroups({} as Db, planned.plan, "target");
    expect(result).toMatchObject({ linked: 0, classified: 1 });
    expect(state.writes[0]).toContain("lock table");
    expect(state.writes.filter((query) => query.includes("harmonization_assert"))).toHaveLength(MATCH_TABLES.length);
    const update = state.writes.find((query) => query.startsWith('update "ebooks"'))!;
    expect(update).toContain('"match_model_version"');
    expect(update).not.toContain('"updated_at"');
    expect(state.writes.some((query) => /insert into "(?:works|editions|instances)"/.test(query))).toBe(false);
  });
  it("preserves an unchanged Keep decision and refuses a later owner decision", async () => {
    const pending = ebook(), kept = ebook({ matchState: "standalone", matchFingerprint: matchFingerprint(pending) });
    const approved = await approval(true, kept);
    state.loaded = snapshot(kept);
    expect(await planApprovedGroupsOn({} as Db, approved, registration(kept), identity)).toEqual({ kind: "unchanged", linked: 0, preserved: 1 });
    state.loaded = snapshot({ ...kept, matchState: "excluded", exclusionReason: "other" });
    await expect(planApprovedGroupsOn({} as Db, approved, registration(kept), identity)).rejects.toThrow("owner decision");
  });
  it("accepts a completed matching operation only for the same run and approval", async () => {
    const external = ebook({ id: "external-ebook", title: "Other title" });
    const approved = await approval(true, undefined, [external]), input = ebook({ id: "registered-ebook", matchState: "linked", instanceId: "copy-1" });
    const current = snapshot(input, true, [external]);
    current.rows.ebooks[0].link_written = {
      approvedGroupHash: dataFingerprint(approved.plan), runId: identity.runId,
      targetDatabase: identity.targetDatabase, instanceId: input.instanceId, ebookId: input.id,
    };
    state.loaded = current;
    expect(await planApprovedGroupsOn({} as Db, approved, registration(input), identity)).toEqual({ kind: "unchanged", linked: 1, preserved: 0 });
    await expect(planApprovedGroupsOn({} as Db, approved, registration(input), { ...identity, runId: "later-run" })).rejects.toThrow("owner decision");
  });
  it("rejects edited sample, model and input scope fingerprints", async () => {
    const approved = await approval();
    for (const mutation of [
      (copy: ApprovedGroupMatching) => { copy.plan.sample = []; },
      (copy: ApprovedGroupMatching) => { copy.plan.binding.modelVersion++; },
      (copy: ApprovedGroupMatching) => { copy.plan.binding.inputFingerprint = "f".repeat(64); },
      (copy: ApprovedGroupMatching) => { delete (copy.plan.binding as Partial<typeof copy.plan.binding>).externalInputFingerprint; },
    ]) {
      const copy = structuredClone(approved);
      mutation(copy);
      expect(() => requireApprovedGroupPlan(copy)).toThrow();
    }
  });
});
