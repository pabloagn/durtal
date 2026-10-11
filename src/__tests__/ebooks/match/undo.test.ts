import { describe, it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
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
const state = vi.hoisted(() => ({
  loaded: null as unknown,
  dependencies: null as unknown,
  calls: [] as string[],
  params: [] as unknown[][],
  dependencyReads: 0,
}));
vi.mock("@/lib/ebooks/match/load", async (importActual) => ({
  ...(await importActual<object>()),
  loadMatchCatalogue: async () => state.loaded,
}));
vi.mock("@/lib/ebooks/match/dependencies", async (importActual) => ({
  ...(await importActual<object>()),
  loadMatchDependencies: async () => {
    state.dependencyReads++;
    return state.dependencies;
  },
}));
vi.mock("@/lib/db/atomic", () => ({
  atomicOn: async (_conn: unknown, build: (d: unknown) => unknown[]) => {
    const dialect = new PgDialect();
    for (const query of build(drizzle.mock())) {
      const compiled = dialect.sqlToQuery((query as { getSQL(): SQL }).getSQL());
      state.calls.push(compiled.sql); state.params.push(compiled.params);
    }
    return [];
  },
}));
import {
  decideUndoCleanup,
  planUndoLinkOn,
  undoLink,
} from "@/lib/ebooks/match/undo";
import {
  MATCH_TABLES,
  type LoadedMatchCatalogue,
} from "@/lib/ebooks/match/load";
import type { LinkReceipt } from "@/lib/ebooks/match/link";
import type {
  DependencySnapshot,
  ForeignReference,
} from "@/lib/ebooks/match/dependencies";
import { catalogue, ebook, work, edition, copy, at } from "./fixtures";
import { hashMatchingPlan } from "@/lib/ebooks/match/plan";
import { reviewUndoOperationId, reviewPayloadHash, REVIEW_RECEIPT_EVENTS } from "@/lib/ebooks/review/receipts";
import { prepareMatchAtomicExtension } from "@/lib/ebooks/match/review-extension";

function scenario() {
  const instance = { id: "copy-1", edition_id: "edition-1", updated_at: at },
    e = { id: "edition-1", work_id: "work-1" },
    w = { id: "work-1", series_id: "series-1" },
    a = { id: "author-1", name: "André Breton" },
    s = { id: "series-1" },
    book = {
      id: "ebook-1",
      match_state: "linked",
      instance_id: "copy-1",
      title: "Nadja",
      updated_at: at,
    };
  const histories = [
    { id: "copy-history", instance_id: "copy-1" },
    { id: "work-history", work_id: "work-1" },
  ];
  const credits = [
      { work_id: "work-1", author_id: "author-1", role: "author" },
    ],
    domains = [{ person_id: "author-1", kind: "book" }];
  const receipt: LinkReceipt = {
    version: 1,
    operationId: "own-op",
    runId: "run",
    planSha256: "a".repeat(64),
    targetDatabase: "target",
    kind: "accession",
    ebookId: "ebook-1",
    instanceId: "copy-1",
    editionId: "edition-1",
    workId: "work-1",
    createdInstance: true,
    createdEdition: true,
    workCreated: true,
    movedFromEditionId: null,
    authorIdsCreated: ["author-1"],
    seriesIdCreated: "series-1",
    historyIdsCreated: histories.map((row) => row.id),
    activityIdsCreated: [],
    before: {
      ebook: {
        ...book,
        match_state: "pending",
        instance_id: null,
        updated_at: at,
      },
      instance: null,
      candidates: [],
    },
    after: {
      ebook: book,
      instance,
      edition: e,
      work: w,
      authors: [a],
      series: s,
      histories,
      activities: [],
      ownedChildren: { work_authors: credits, person_domains: domains },
    },
  };
  const rows = {
    ...Object.fromEntries(MATCH_TABLES.map((table) => [table, []])),
    ebooks: [{ ...book, link_written: receipt }],
    instances: [instance],
    editions: [e],
    works: [w],
    authors: [a],
    series: [s],
    work_authors: credits,
  } as unknown as LoadedMatchCatalogue["rows"];
  const ref = (
    parentTable: string,
    childTable: string,
    column: string,
  ): ForeignReference => ({
    parentTable,
    childTable,
    parentColumns: ["id"],
    childColumns: [column],
  });
  const dependencies: DependencySnapshot = {
    references: [
      ref("instances", "ebooks", "instance_id"),
      ref("editions", "instances", "edition_id"),
      ref("works", "editions", "work_id"),
      ref("works", "work_authors", "work_id"),
      ref("authors", "work_authors", "author_id"),
      ref("authors", "person_domains", "person_id"),
      ref("series", "works", "series_id"),
      ref("instances", "instance_status_history", "instance_id"),
      ref("works", "work_status_history", "work_id"),
    ],
    rows: {
      ebooks: rows.ebooks,
      instances: rows.instances,
      editions: rows.editions,
      works: rows.works,
      work_authors: credits,
      person_domains: domains,
      instance_status_history: [histories[0]],
      work_status_history: [histories[1]],
      activity_events: [],
    },
  };
  const loaded: LoadedMatchCatalogue = {
    rows,
    catalogue: catalogue({
      ebooks: [ebook({ instanceId: "copy-1", matchState: "linked" })],
      works: [
        work({
          editions: [edition()],
          copies: [copy({ linkedEbookId: "ebook-1" })],
        }),
      ],
    }),
    catalogueFingerprint: "b".repeat(64),
    inputFingerprint: "c".repeat(64),
  };
  return { loaded, dependencies, receipt };
}
describe("operation-owned matching undo", () => {
  function filledScenario() {
    const s = scenario();
    s.receipt.createdInstance = false; s.receipt.createdEdition = false; s.receipt.workCreated = false;
    s.receipt.authorIdsCreated = []; s.receipt.after!.authors = []; s.receipt.seriesIdCreated = null; s.receipt.after!.series = null;
    Object.assign(s.receipt.after!.instance, { format: "epub", file_size_bytes: 1000, notes: "preserve owner metadata" });
    s.receipt.before.instance = { ...s.receipt.after!.instance, format: null, file_size_bytes: 42,
      updated_at: "2026-10-09T11:59:59.123456+00:00" };
    s.receipt.fillProvenance = { fields: ["format", "file_size_bytes"], expected: { format: "epub", fileSizeBytes: 1000 } };
    s.dependencies = { ...s.dependencies, rows: { ...s.dependencies.rows, instance_status_history: [] } };
    return s;
  }
  it("restores only the owned fill fields with the precise original timestamp", async () => {
    const s = filledScenario(), cleanup = decideUndoCleanup(s.receipt, s.loaded, s.dependencies);
    expect(cleanup.restoreCopy).toEqual({ id: "copy-1", editionId: "edition-1", format: null,
      fileSizeBytes: 42, updatedAt: "2026-10-09T11:59:59.123456+00:00" });
    state.loaded = s.loaded; state.dependencies = s.dependencies; state.calls.length = 0; state.params.length = 0;
    const next = await planUndoLinkOn({} as Db, s.receipt, "target", at);
    if (next.kind !== "planned") throw new Error("Expected undo plan");
    await undoLink({} as Db, next.plan, "target");
    const indexes = state.calls.flatMap((query, index) => query.startsWith("update instances") ? [index] : []);
    expect(indexes).toHaveLength(1); const index = indexes[0];
    expect(state.calls[index]).toContain("format="); expect(state.calls[index]).toContain("file_size_bytes=");
    expect(state.calls[index]).not.toContain("notes=");
    expect(state.params[index]).toContain("2026-10-09T11:59:59.123456+00:00");
    expect(state.params[index]).toContain(null); expect(state.params[index]).toContain(42);
    expect(state.calls.findIndex((query) => query.includes("pg_constraint"))).toBeLessThan(index);
  });
  it("restores move and fill together only while the complete original parent remains unchanged", () => {
    const s = filledScenario(), original = { id: "old-edition", work_id: "work-1", metadata_locked: false, notes: "original" };
    s.receipt.movedFromEditionId = "old-edition"; s.receipt.before.instance!.edition_id = "old-edition";
    s.receipt.before.originalEdition = original; s.loaded.rows.editions = [...s.loaded.rows.editions, original];
    expect(decideUndoCleanup(s.receipt, s.loaded, s.dependencies).restoreCopy).toMatchObject({ editionId: "old-edition", format: null, fileSizeBytes: 42 });
    s.loaded.rows.editions = [s.receipt.after!.edition, { ...original, notes: "edited" }];
    expect(decideUndoCleanup(s.receipt, s.loaded, s.dependencies)).toMatchObject({ restoreCopy: null,
      retained: [expect.objectContaining({ reason: "original edition changed" })] });
  });
  it.each(["readings", "annotations", "a_future_table", "ebooks"])("keeps a filled copy referenced by later %s even without a timestamp edit", (table) => {
    const s = filledScenario();
    s.dependencies = { references: [...s.dependencies.references, { parentTable: "instances", childTable: table,
      parentColumns: ["id"], childColumns: ["instance_id"] }],
      rows: { ...s.dependencies.rows, [table]: [...(s.dependencies.rows[table] ?? []), { id: "later-owner", instance_id: "copy-1" }] } };
    expect(decideUndoCleanup(s.receipt, s.loaded, s.dependencies)).toMatchObject({ restoreCopy: null,
      retained: [expect.objectContaining({ reason: "referenced copy" })] });
  });
  it.each(["missing-original", "wrong-marker", "unowned-field", "edited", "parent-taken", "missing-parent-snapshot"])("keeps a filled copy when %s prevents proving ownership", (variant) => {
    const s = filledScenario();
    if (variant === "missing-original") delete s.receipt.before.instance!.file_size_bytes;
    if (variant === "wrong-marker") s.receipt.fillProvenance!.expected.fileSizeBytes = 999;
    if (variant === "unowned-field") s.receipt.fillProvenance!.fields = ["format"];
    if (variant === "edited") s.loaded.rows.instances = [{ ...s.receipt.after!.instance, notes: "later" }];
    if (variant === "parent-taken" || variant === "missing-parent-snapshot") {
      s.receipt.movedFromEditionId = "old-edition"; s.receipt.before.instance!.edition_id = "old-edition";
      const original = { id: "old-edition", work_id: "work-1", metadata_locked: false };
      s.receipt.before.originalEdition = original; s.loaded.rows.editions = [...s.loaded.rows.editions, original];
      s.loaded.rows.instances = [...s.loaded.rows.instances, { id: "later-copy", edition_id: "old-edition" }];
      s.loaded.rows.ebooks = [...s.loaded.rows.ebooks, { id: "later-ebook", instance_id: "later-copy" }];
      if (variant === "missing-parent-snapshot") delete s.receipt.before.originalEdition;
    }
    expect(decideUndoCleanup(s.receipt, s.loaded, s.dependencies).restoreCopy).toBeNull();
  });
  it("gives legacy receipts no authority to restore digital fields and preserves durable review activity", () => {
    const s = filledScenario(); delete s.receipt.fillProvenance;
    const review = { id: "review-row", entity_type: "ebook", entity_id: "ebook-1", event_key: "ebook.review.decision.v1" };
    s.receipt.after!.activities = [review]; s.receipt.activityIdsCreated = ["review-row"];
    s.dependencies = { ...s.dependencies, rows: { ...s.dependencies.rows, activity_events: [review] } };
    expect(decideUndoCleanup(s.receipt, s.loaded, s.dependencies)).toMatchObject({ restoreCopy: null, activityIds: [] });
  });
  it("hashes compensation and refuses it without a trusted extension before mutation", async () => {
    const s = filledScenario(); state.loaded = s.loaded; state.dependencies = s.dependencies;
    const next = await planUndoLinkOn({} as Db, s.receipt, "target", at);
    if (next.kind !== "planned") throw new Error("Expected undo plan");
    const original = { version: 1 as const, operationId: "10000000-0000-4000-8000-000000000001",
      runId: "20000000-0000-4000-8000-000000000001", planSha256: "a".repeat(64), targetDatabase: "target" };
    next.plan.reviewCompensation = { originalOperation: original, compensationOperationId: reviewUndoOperationId(original),
      originalAfterUpdatedAt: "2026-10-09T12:00:00.000000Z" };
    expect(hashMatchingPlan(next.plan)).not.toBe(next.plan.planSha256);
    next.plan.planSha256 = hashMatchingPlan(next.plan); state.calls.length = 0;
    await expect(undoLink({} as Db, next.plan, "target")).rejects.toThrow("trusted extension");
    expect(state.calls).toEqual([]);
    s.loaded.rows.ebooks = [{ ...s.loaded.rows.ebooks[0], notes: "later" }];
    await expect(planUndoLinkOn({} as Db, s.receipt, "target", at, { reviewCompensation: next.plan.reviewCompensation })).rejects.toThrow("unchanged full");
  });
  it("uses the locked original receipt and DB-forward version without classification overwriting it", async () => {
    const source = filledScenario();
    const ids: Record<string, string> = Object.fromEntries(["ebook-1", "copy-1", "edition-1", "work-1", "own-op", "run"]
      .map((id, index) => [id, `${index + 1}0000000-0000-4000-8000-000000000001`]));
    const convert = <T,>(input: T): T => JSON.parse(JSON.stringify(input), (_key, value) => typeof value === "string" ? ids[value] ?? value : value);
    const s = { receipt: convert(source.receipt), dependencies: convert(source.dependencies),
      loaded: { ...source.loaded, rows: convert(source.loaded.rows), catalogue: catalogue(convert(source.loaded.catalogue.source)) } };
    const ebookId = s.receipt.ebookId, updatedAt = "2026-10-09T12:00:00.000000Z";
    Object.assign(s.receipt.after!.ebook, { match_tier: null, match_fingerprint: null, exclusion_reason: null });
    s.loaded.rows.ebooks = [{ ...s.receipt.after!.ebook, link_written: s.receipt }];
    const operation = { version: 1 as const, operationId: "90000000-0000-4000-8000-000000000001",
      runId: s.receipt.runId, planSha256: "d".repeat(64), targetDatabase: "target" };
    const after = { matchState: "linked", matchTier: null, matchFingerprint: null, updatedAt,
      instanceId: s.receipt.instanceId, exclusionReason: null, candidatesHash: reviewPayloadHash([]) };
    const original = { id: operation.operationId, entity_type: "ebook", entity_id: ebookId,
      event_key: REVIEW_RECEIPT_EVENTS.ebookDecision, metadata: { extra: { ebookReview: {
        version: 1, operation, entityType: "ebook", entityId: ebookId, eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision,
        action: "link", originalOperation: null, requestHash: "b".repeat(64), effectHash: "c".repeat(64),
        outcome: { keptCopy: false, message: "Linked" }, after,
        before: { ...after, matchState: "pending", instanceId: null, updatedAt: "2026-10-09T11:59:59.123456Z" },
      } } } };
    s.dependencies = { ...s.dependencies, rows: { ...s.dependencies.rows, activity_events: [original], ebooks: s.loaded.rows.ebooks } };
    state.loaded = s.loaded; state.dependencies = s.dependencies;
    const policy = { originalOperation: operation, compensationOperationId: reviewUndoOperationId(operation), originalAfterUpdatedAt: updatedAt };
    const conn = { execute: async () => [{ row: original, updatedAt }] } as unknown as Db;
    const planned = await planUndoLinkOn(conn, s.receipt, "target", at, { reviewCompensation: policy });
    if (planned.kind !== "planned") throw new Error("Expected review undo");
    const extension = prepareMatchAtomicExtension({ coreWriter: "undo_link", coreOperation: planned.plan,
      ebookIds: [ebookId], purpose: "compensation", compensation: policy,
      reviewOperations: [{ ...operation, operationId: policy.compensationOperationId }] },
      { extraTables: ["activity_events"], before: (d) => [d.execute(sql`select ${'before review'}`)], after: (d) => [d.execute(sql`select ${'after review'}`)] });
    state.calls.length = 0; state.params.length = 0;
    await undoLink({} as Db, planned.plan, "target", { atomicExtension: extension });
    const versions = state.calls.filter((query) => query.startsWith('update "ebooks"') && query.includes('"updated_at" ='));
    expect(versions).toHaveLength(1); expect(versions[0]).toContain("greatest(clock_timestamp()");
    expect(versions[0]).toContain("ebooks.updated_at + interval '1 microsecond'");
    expect(versions[0]).toContain("from activity_events a");
    expect(state.calls.some((query) => query.includes("IS TRUE") && query.includes("isfinite(e.updated_at)"))).toBe(true);
    expect(state.params.at(-1)).toEqual(["after review"]);
    expect(state.calls.filter((query) => query.startsWith("update instances"))).toHaveLength(1);
  });
  it.each(["queued-owned", "running", "edited", "unowned", "referenced"])(
    "handles a %s enrichment job without deleting work that has later activity",
    (variant) => {
      const s = scenario();
      const saved = {
        id: "job-1", work_id: "work-1", status: "queued", attempts: 0,
        payload: { matchingOperationId: s.receipt.operationId },
      };
      s.receipt.after!.ownedChildren = {
        ...s.receipt.after!.ownedChildren, enrichment_jobs: [saved],
      };
      const current = {
        ...saved,
        ...(variant === "running" ? { status: "running", attempts: 1 } : {}),
        ...(variant === "edited" ? { priority: 10 } : {}),
        ...(variant === "unowned" ? { payload: {} } : {}),
      };
      s.dependencies = {
        references: [...s.dependencies.references, {
          parentTable: "works", childTable: "enrichment_jobs",
          parentColumns: ["id"], childColumns: ["work_id"],
        }, ...(variant === "referenced" ? [{
          parentTable: "enrichment_jobs", childTable: "enrichment_logs",
          parentColumns: ["id"], childColumns: ["job_id"],
        }] : [])],
        rows: { ...s.dependencies.rows, enrichment_jobs: [current],
          ...(variant === "referenced" ? { enrichment_logs: [{ id: "log-1", job_id: "job-1" }] } : {}),
        },
      };
      const result = decideUndoCleanup(s.receipt, s.loaded, s.dependencies);
      expect(result.deleted.works).toEqual(variant === "queued-owned" ? ["work-1"] : []);
      expect(result.jobIds).toEqual(variant === "queued-owned" ? ["job-1"] : []);
    },
  );
  it("refuses inconsistent committed parent identities", () => {
    const s = scenario();
    s.receipt.after!.instance.edition_id = "a-later-edition";
    expect(() => decideUndoCleanup(s.receipt, s.loaded, s.dependencies)).toThrow("parent identities");
  });
  it("removes unchanged created parents and their exact owned children", () => {
    const s = scenario();
    expect(
      decideUndoCleanup(s.receipt, s.loaded, s.dependencies).deleted,
    ).toEqual({
      instances: ["copy-1"],
      editions: ["edition-1"],
      works: ["work-1"],
      authors: ["author-1"],
      series: ["series-1"],
    });
  });
  it.each(["readings", "annotations", "a_future_table"])(
    "preserves the created chain when %s references its copy",
    (table) => {
      const s = scenario();
      s.dependencies = {
        references: [
          ...s.dependencies.references,
          {
            parentTable: "instances",
            childTable: table,
            parentColumns: ["id"],
            childColumns: ["instance_id"],
          },
        ],
        rows: {
          ...s.dependencies.rows,
          [table]: [{ id: "owner-row", instance_id: "copy-1" }],
        },
      };
      const cleanup = decideUndoCleanup(s.receipt, s.loaded, s.dependencies);
      expect(Object.values(cleanup.deleted).flat()).toEqual([]);
      expect(cleanup.retained[0]).toMatchObject({
        table: "instances",
        reason: "referenced",
      });
    },
  );
  it("keeps edited status history, parent metadata and cross-domain author references", () => {
    const s = scenario();
    s.dependencies = {
      ...s.dependencies,
      rows: {
        ...s.dependencies.rows,
        instance_status_history: [
          { id: "copy-history", instance_id: "copy-1", notes: "owner edit" },
        ],
      },
    };
    expect(
      decideUndoCleanup(s.receipt, s.loaded, s.dependencies).deleted.instances,
    ).toEqual([]);
    const a = scenario();
    a.dependencies = {
      references: [
        ...a.dependencies.references,
        {
          parentTable: "authors",
          childTable: "film_credits",
          parentColumns: ["id"],
          childColumns: ["person_id"],
        },
      ],
      rows: {
        ...a.dependencies.rows,
        film_credits: [{ person_id: "author-1" }],
      },
    };
    expect(
      decideUndoCleanup(a.receipt, a.loaded, a.dependencies).deleted,
    ).toMatchObject({ works: ["work-1"], authors: [] });
    const b = scenario();
    b.loaded.rows.editions = [{ ...b.receipt.after!.edition, notes: "edited" }];
    b.dependencies = {
      ...b.dependencies,
      rows: { ...b.dependencies.rows, editions: b.loaded.rows.editions },
    };
    expect(
      decideUndoCleanup(b.receipt, b.loaded, b.dependencies).deleted.editions,
    ).toEqual([]);
  });
  it("restores an unchanged moved copy and removes its own new edition, while retaining a changed copy", () => {
    const s = scenario();
    s.receipt.createdInstance = false;
    s.receipt.workCreated = false;
    s.receipt.authorIdsCreated = [];
    s.receipt.after!.authors = [];
    s.receipt.seriesIdCreated = null;
    s.receipt.after!.series = null;
    s.receipt.movedFromEditionId = "old-edition";
    s.receipt.before.instance = {
      id: "copy-1",
      edition_id: "old-edition",
      updated_at: at,
    };
    s.loaded.rows.editions = [
      ...s.loaded.rows.editions,
      { id: "old-edition", work_id: "work-1", metadata_locked: false },
    ];
    // This is an existing moved copy, with no newly inserted instance history.
    s.dependencies = { ...s.dependencies, rows: { ...s.dependencies.rows, instance_status_history: [] } };
    expect(
      decideUndoCleanup(s.receipt, s.loaded, s.dependencies),
    ).toMatchObject({
      restoreCopy: { editionId: "old-edition" },
      deleted: { instances: [], editions: ["edition-1"] },
    });
    s.loaded.rows.instances = [
      { ...s.receipt.after!.instance, notes: "owner edit" },
    ];
    s.dependencies = {
      ...s.dependencies,
      rows: { ...s.dependencies.rows, instances: s.loaded.rows.instances },
    };
    expect(
      decideUndoCleanup(s.receipt, s.loaded, s.dependencies),
    ).toMatchObject({ restoreCopy: null, deleted: { editions: [] } });
  });
  it.each(["operationId", "runId", "planSha256"] as const)(
    "refuses a later operation with different %s before inspecting deletion dependencies",
    async (key) => {
      const s = scenario();
      state.loaded = s.loaded;
      state.dependencies = s.dependencies;
      state.dependencyReads = 0;
      const next = { ...s.receipt, [key]: "later" };
      expect(await planUndoLinkOn({} as Db, next, "target")).toEqual({
        kind: "unchanged",
        reason: "missing_or_later_operation",
      });
      expect(state.dependencyReads).toBe(0);
    },
  );
  it("reclassifies after unlink without automatic writes and guards every dependency inside its atomic", async () => {
    const s = scenario();
    s.receipt.createdInstance = false;
    s.receipt.createdEdition = false;
    s.receipt.workCreated = false;
    s.receipt.authorIdsCreated = [];
    s.receipt.after!.authors = [];
    s.receipt.seriesIdCreated = null;
    s.receipt.after!.series = null;
    state.loaded = s.loaded;
    state.dependencies = s.dependencies;
    state.calls.length = 0;
    const planned = await planUndoLinkOn({} as Db, s.receipt, "target", at);
    expect(planned.kind).toBe("planned");
    if (planned.kind !== "planned") throw new Error("Missing undo plan");
    expect(planned.plan.classification).toMatchObject({
      tier: "strong",
      autoLink: true,
    });
    await undoLink({} as Db, planned.plan, "target");
    expect(state.calls[0]).toContain("lock table");
    expect(
      state.calls.filter((query) => query.includes("harmonization_assert")),
    ).toHaveLength(
      MATCH_TABLES.length + Object.keys(s.dependencies.rows).length + 1,
    );
    expect(
      state.calls.some((query) =>
        /insert into "(?:works|editions|instances)"/.test(query),
      ),
    ).toBe(false);
    expect(
      state.calls.some((query) =>
        query.startsWith('insert into "ebook_match_candidates"'),
      ),
    ).toBe(true);
    expect(
      state.calls.some((query) => query.includes('"link_written" =')),
    ).toBe(true);
    s.loaded.rows.ebooks = [
      {
        id: "ebook-1",
        match_state: "pending",
        instance_id: null,
        link_written: null,
      },
    ];
    expect(await planUndoLinkOn({} as Db, s.receipt, "target")).toMatchObject({
      kind: "unchanged",
    });
  });
});
