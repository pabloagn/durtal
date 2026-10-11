import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("Global database forbidden");
      },
    },
  ),
}));
const { calls, state } = vi.hoisted(() => ({ calls: [] as string[], state: { loaded: null as unknown,
  params: [] as unknown[][], results: [{ marker: "actual atomic result" }] } }));
vi.mock("@/lib/ebooks/match/load", async (importActual) => ({
  ...(await importActual<object>()), loadMatchCatalogue: async () => state.loaded,
}));
vi.mock("@/lib/db/atomic", () => ({
  atomicOn: async (_conn: unknown, build: (d: unknown) => unknown[]) => {
    const database = drizzle.mock();
    const queries = build(database);
    const dialect = new PgDialect();
    for (const query of queries) {
      const compiled = dialect.sqlToQuery((query as { getSQL(): SQL }).getSQL());
      calls.push(compiled.sql); state.params.push(compiled.params);
    }
    return state.results;
  },
}));
import {
  classifyLoaded,
  hashMatchingPlan,
  validateMatchingPlan,
  planMatchingOn,
  type ClassificationPlan,
} from "@/lib/ebooks/match/plan";
import { persistClassification } from "@/lib/ebooks/match/classification";
import {
  MATCH_TABLES,
  dataFingerprint,
  type LoadedMatchCatalogue,
} from "@/lib/ebooks/match/load";
import { MATCH_MODEL } from "@/lib/ebooks/match/model";
import { matchFingerprint } from "@/lib/ebooks/match/keys";
import { catalogue, ebook, work, edition, copy } from "./fixtures";
import { prepareMatchAtomicExtension } from "@/lib/ebooks/match/review-extension";
import { reviewPayloadHash, reviewUndoOperationId, REVIEW_RECEIPT_EVENTS } from "@/lib/ebooks/review/receipts";

function loaded(
  state: "excluded" | "standalone" = "excluded",
): LoadedMatchCatalogue {
  const file = ebook();
  return {
    catalogue: catalogue({
      ebooks: [
        {
          ...file,
          matchState: state,
          matchFingerprint: matchFingerprint(file),
          exclusionReason: state === "excluded" ? "other" : null,
        },
      ],
      works: [work({ editions: [edition()], copies: [copy()] })],
    }),
    rows: {
      ...Object.fromEntries(MATCH_TABLES.map((table) => [table, []])),
      ebooks: [
        {
          id: file.id,
          match_state: state,
          exclusion_reason: state === "excluded" ? "other" : null,
        },
      ],
    } as unknown as LoadedMatchCatalogue["rows"],
    catalogueFingerprint: "a".repeat(64),
    inputFingerprint: "b".repeat(64),
  };
}
function plan(snapshot: LoadedMatchCatalogue): ClassificationPlan {
  const next: ClassificationPlan = {
    version: 1,
    operationId: "op",
    runId: "run",
    planSha256: "",
    targetDatabase: "target",
    kind: "classification",
    mode: "classification_only",
    createdAt: "2026-10-09T12:00:00Z",
    modelFingerprint: dataFingerprint(MATCH_MODEL),
    snapshot: {
      rows: snapshot.rows,
      catalogueFingerprint: snapshot.catalogueFingerprint,
      inputFingerprint: snapshot.inputFingerprint,
    },
    results: classifyLoaded(snapshot, ["ebook-1"], {
      mode: "classification_only",
      restoreIds: ["ebook-1"],
    }),
    restoreIds: ["ebook-1"],
  };
  next.planSha256 = hashMatchingPlan(next);
  return next;
}
describe("classification-only restore", () => {
  it.each(["standalone", "excluded"] as const)("prepares a real %s restoration with hashed compensation and returns awaited extension results", async (matchState) => {
    const snapshot = loaded(matchState), ebookId = "30000000-0000-4000-8000-000000000001";
    const file = { ...snapshot.catalogue.source.ebooks[0], id: ebookId };
    snapshot.catalogue = catalogue({ ...snapshot.catalogue.source, ebooks: [file] });
    const updatedAt = "2026-10-09T12:00:00.123456Z", fingerprint = matchFingerprint(file);
    snapshot.rows.ebooks = [{ id: ebookId, match_state: matchState, match_tier: null, instance_id: null,
      match_fingerprint: fingerprint, exclusion_reason: matchState === "excluded" ? "other" : null,
      updated_at: "2026-10-09T12:00:00.123456+00:00" }];
    const operation = { version: 1 as const, operationId: "10000000-0000-4000-8000-000000000001",
      runId: "20000000-0000-4000-8000-000000000001", planSha256: "a".repeat(64), targetDatabase: "target" };
    const after = { matchState, matchTier: null, matchFingerprint: fingerprint, updatedAt,
      instanceId: null, exclusionReason: matchState === "excluded" ? "other" : null, candidatesHash: reviewPayloadHash([]) };
    const original = { id: operation.operationId, entity_type: "ebook", entity_id: ebookId,
      event_key: REVIEW_RECEIPT_EVENTS.ebookDecision, metadata: { extra: { ebookReview: {
        version: 1, operation, entityType: "ebook", entityId: ebookId, eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision,
        action: matchState === "standalone" ? "keep" : "exclude", originalOperation: null,
        before: { ...after, matchState: "pending", exclusionReason: null, updatedAt: "2026-10-09T11:59:59.123456Z" },
        after, requestHash: "b".repeat(64), effectHash: "c".repeat(64), outcome: { message: "Decided", keptCopy: false },
      } } } };
    state.loaded = snapshot;
    const conn = { execute: async () => [{ row: original, updatedAt }] } as unknown as Db;
    const policy = { originalOperation: operation, compensationOperationId: reviewUndoOperationId(operation), originalAfterUpdatedAt: updatedAt };
    const frozen = await planMatchingOn(conn, [ebookId], { targetDatabase: "target", mode: "classification_only",
      restoreIds: [ebookId], reviewCompensation: policy, now: "2026-10-09T12:00:00Z" });
    expect(frozen.reviewCompensation).toEqual(policy); expect(frozen.runId).toBe(operation.runId);
    expect(frozen.results[0].skipped).toBeNull(); expect(snapshot.catalogue.source.ebooks[0].matchState).toBe(matchState);
    expect(hashMatchingPlan({ ...frozen, reviewCompensation: { ...policy, originalAfterUpdatedAt: "2026-10-09T12:00:00.123457Z" } })).not.toBe(frozen.planSha256);
    calls.length = 0; state.params.length = 0;
    await expect(persistClassification({} as Db, frozen, "target")).rejects.toThrow("trusted extension");
    expect(calls).toEqual([]);
    const extension = prepareMatchAtomicExtension({ coreWriter: "classification", coreOperation: frozen, ebookIds: [ebookId],
      purpose: "compensation", compensation: policy, reviewOperations: [{ ...operation, operationId: policy.compensationOperationId }] },
      { extraTables: ["activity_events"], before: (d) => [d.execute(sql`select ${'before review'}`)], after: (d) => [d.execute(sql`select ${'after review'}`)] });
    expect(await persistClassification({} as Db, frozen, "target", { atomicExtension: extension })).toBe(state.results);
    const updates = calls.filter((query) => query.startsWith('update "ebooks"') && query.includes('"updated_at" ='));
    expect(updates).toHaveLength(1); expect(updates[0]).toContain("greatest(clock_timestamp()");
    expect(updates[0]).toContain("from activity_events a");
    expect(calls.some((query) => /insert into "(?:works|editions|instances)"/.test(query))).toBe(false);
    expect(state.params.at(-1)).toEqual(["after review"]);
    await expect(planMatchingOn(conn, [ebookId, "40000000-0000-4000-8000-000000000001"], {
      targetDatabase: "target", mode: "classification_only", restoreIds: [ebookId], reviewCompensation: policy,
    })).rejects.toThrow("one target");
    const stale = { ...policy, originalAfterUpdatedAt: "2026-10-09T12:00:00.123457Z" };
    await expect(planMatchingOn(conn, [ebookId], { targetDatabase: "target", mode: "classification_only",
      restoreIds: [ebookId], reviewCompensation: stale })).rejects.toThrow("exact after-state");
  });
  it.each(["standalone", "excluded"] as const)(
    "reclassifies unchanged %s metadata without overriding the stored decision in memory",
    (state) => {
      const snapshot = loaded(state),
        before = JSON.stringify(snapshot.catalogue.source);
      expect(classifyLoaded(snapshot, ["ebook-1"])[0].skipped).toBe(
        "unchanged_decision",
      );
      const result = plan(snapshot).results[0];
      expect(result).toMatchObject({
        tier: "strong",
        autoLink: true,
        skipped: null,
      });
      expect(JSON.stringify(snapshot.catalogue.source)).toBe(before);
    },
  );
  it("persists classification and clears the exclusion reason while having no link/accession writer branch", async () => {
    calls.length = 0;
    const snapshot = loaded(),
      frozen = JSON.parse(JSON.stringify(plan(snapshot))) as ClassificationPlan;
    validateMatchingPlan(frozen, "target");
    expect(await persistClassification({} as Db, frozen, "target")).toBeUndefined();
    expect(calls[0]).toContain("lock table");
    expect(
      calls.filter((query) => query.includes("harmonization_assert")),
    ).toHaveLength(MATCH_TABLES.length);
    expect(
      calls.some((query) =>
        query.startsWith('insert into "ebook_match_candidates"'),
      ),
    ).toBe(true);
    expect(calls.some((query) => query.includes('"exclusion_reason" ='))).toBe(
      true,
    );
    expect(
      calls.some((query) =>
        /insert into "(?:works|editions|instances)"/.test(query),
      ),
    ).toBe(false);
    expect(
      calls.some(
        (query) =>
          query.includes('"instance_id" =') ||
          query.includes('"link_written" ='),
      ),
    ).toBe(false);
  });
  it("binds restore mode and exclusion reason in its plan hash independently of bibliographic fingerprint", () => {
    const p = plan(loaded());
    expect(() =>
      validateMatchingPlan({ ...p, mode: "ingestion" }, "target"),
    ).toThrow("hash changed");
    const changed = JSON.parse(JSON.stringify(p)) as ClassificationPlan;
    changed.snapshot.rows.ebooks[0].exclusion_reason = "duplicate";
    expect(() => validateMatchingPlan(changed, "target")).toThrow(
      "hash changed",
    );
    expect(() =>
      classifyLoaded(loaded(), ["ebook-1"], { restoreIds: ["ebook-1"] }),
    ).toThrow("classification-only");
  });
});
