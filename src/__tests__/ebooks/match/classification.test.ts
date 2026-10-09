import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import type { SQL } from "drizzle-orm";
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
const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/db/atomic", () => ({
  atomicOn: async (_conn: unknown, build: (d: unknown) => unknown[]) => {
    const database = drizzle.mock();
    const queries = build(database);
    const dialect = new PgDialect();
    for (const query of queries)
      calls.push(dialect.sqlToQuery((query as { getSQL(): SQL }).getSQL()).sql);
    return [];
  },
}));
import {
  classifyLoaded,
  hashMatchingPlan,
  validateMatchingPlan,
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
    await persistClassification({} as Db, frozen, "target");
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
