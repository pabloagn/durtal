import { describe, it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
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
const state = vi.hoisted(() => ({
  loaded: null as unknown,
  dependencies: null as unknown,
  calls: [] as string[],
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
    state.calls.push(
      ...build(drizzle.mock()).map(
        (query) =>
          dialect.sqlToQuery((query as { getSQL(): SQL }).getSQL()).sql,
      ),
    );
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
      MATCH_TABLES.length + Object.keys(s.dependencies.rows).length,
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
