import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ReadingWithFingerprint, Session } from "@/lib/reading/service";

type Query = { run: () => void };
const store = vi.hoisted(() => ({
  reading: {} as ReadingWithFingerprint,
  sessions: [] as Session[],
  writes: [] as { table: string; values: Record<string, unknown> }[],
  batches: 0,
  race: false,
}));

// Only persistence/loading boundaries are mocked. The exported action, schema,
// session correction, planning, recompute queries and position rules are real.
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => ({ where: async () => {
  if (getTableName(table) !== "editions") throw new Error("Unexpected database read");
  return [{ title: "Other edition" }];
} }) }) } }));
vi.mock("@/lib/reading/activity", () => ({ readingEvent: vi.fn(), progressEvent: vi.fn() }));
vi.mock("@/lib/cache", () => ({ cached: (fn: unknown) => fn, invalidate: vi.fn(), CACHE_TAGS: {} }));
vi.mock("@/lib/catalogue/book-boundary", () => ({ requireBookWork: vi.fn() }));
vi.mock("@/lib/reading/timer-service", () => ({ refuseWhileTiming: vi.fn() }));
vi.mock("@/lib/reading/service", async (original) => ({
  ...await original<typeof import("@/lib/reading/service")>(),
  loadReading: async () => ({ ...store.reading }),
  loadSessions: async () => store.sessions.map((s) => ({ ...s })),
  editionPages: async () => ({ workId: store.reading.workId, pageCount: 1200 }),
  guardReading: (_db: unknown, _id: string, fingerprint: string) => [{ run: () => {
    if (store.race || fingerprint !== store.reading.fingerprint) throw new Error("This reading changed elsewhere; reload before saving");
  } }],
}));
vi.mock("@/lib/db/atomic", () => ({ atomic: async (build: (db: unknown) => Query[]) => {
  const reading = { ...store.reading };
  const sessions = store.sessions.map((s) => ({ ...s }));
  const writes = [...store.writes];
  const db = { update: (table: Parameters<typeof getTableName>[0]) => ({ set: (values: Record<string, unknown>) => ({ where: (where: SQL) => ({ run: () => {
    const name = getTableName(table);
    const id = new PgDialect().sqlToQuery(where).params[0];
    store.writes.push({ table: name, values });
    if (name === "readings") {
      Object.assign(store.reading, values);
      // Check every statement, not just the eventual transaction result.
      for (const prefix of ["start", "current"] as const) {
        if (store.reading.totalPages != null && (store.reading[`${prefix}Page`] ?? 0) > store.reading.totalPages) throw new Error("reading_position_check");
        if (store.reading.totalMinutes != null && (store.reading[`${prefix}Minutes`] ?? 0) > store.reading.totalMinutes) throw new Error("reading_position_check");
      }
    } else if (name === "reading_sessions") {
      const session = store.sessions.find((s) => s.id === id);
      if (!session) throw new Error("Missing session");
      Object.assign(session, values);
    } else throw new Error(`Unexpected write: ${name}`);
  } }) }) }) };
  store.batches++;
  try { for (const query of build(db)) query.run(); }
  catch (error) { store.reading = reading; store.sessions = sessions; store.writes = writes; throw error; }
} }));

import { updateReading } from "@/lib/actions/reading";
import { planPositions, sessionOrder } from "@/lib/reading/service";

const ID = "11111111-1111-4111-8111-111111111111";
const LOG = "22222222-2222-4222-8222-222222222222";
const FP = "0123456789abcdef0123456789abcdef";
const edit = (patch: Omit<Parameters<typeof updateReading>[0], "readingId" | "fingerprint">) => updateReading({ readingId: ID, fingerprint: FP, ...patch });
const snapshot = () => structuredClone({ reading: store.reading, sessions: store.sessions });

beforeEach(() => {
  store.reading = { id: ID, workId: ID, editionId: ID, fingerprint: FP, unit: "pages", format: "print", status: "reading", totalPages: 600, totalMinutes: null,
    startPage: 0, startPercent: 0, startMinutes: null, currentPage: 300, currentPercent: 50, currentMinutes: null, currentChapter: "I",
    startedOn: null, startedPrecision: "unknown", finishedOn: null, finishedPrecision: "unknown", rating: null } as ReadingWithFingerprint;
  store.sessions = [{ id: LOG, readingId: ID, editionId: ID, format: "print", source: "manual", readOn: "2026-09-02", createdAt: new Date("2026-09-02"),
    endedAt: null, startedAt: null, durationSeconds: 1200, note: "Keep", pagesTotal: 600, startPage: 0, startPercent: 0, startMinutes: null,
    endPage: 300, endPercent: 50, endMinutes: null, endChapter: "I" } as Session];
  store.writes = []; store.batches = 0; store.race = false;
});

describe("exported updateReading combined and sequential saves", () => {
  it("corrects the persisted log for an explicit percentage under revised totals and retains it after later saves", async () => {
    const history = { ...store.sessions[0] };
    expect(await edit({ totalPages: 1200, currentPosition: { percent: 50 } })).toMatchObject({ currentPage: 600, currentPercent: 50 });
    expect(store.sessions[0]).toMatchObject({ endPage: 600, endPercent: 50, pagesTotal: 1200, id: history.id, source: history.source, readOn: history.readOn, durationSeconds: history.durationSeconds, note: history.note, createdAt: history.createdAt });
    expect(await edit({ currentChapter: "II" })).toMatchObject({ currentPage: 600, currentPercent: 50 });
    expect(await edit({ rating: 4 })).toMatchObject({ currentPage: 600, currentPercent: 50 });
    expect(planPositions(store.reading, sessionOrder(store.sessions)).position).toMatchObject({ page: 600, percent: 50 });
  });

  it.each([{ page: 200 }, { percent: 100 }])("stages smaller totals/start/current together without an invalid intermediate reading (%j)", async (currentPosition) => {
    Object.assign(store.reading, { startPage: 400, startPercent: 66.67, currentPage: 500, currentPercent: 83.33 });
    Object.assign(store.sessions[0], { startPage: 400, startPercent: 66.67, endPage: 500, endPercent: 83.33 });
    const page = "page" in currentPosition ? 200 : 300;
    expect(await edit({ totalPages: 300, startPage: 100, currentPosition, rating: 4 })).toMatchObject({ totalPages: 300, startPage: 100, currentPage: page, rating: 4 });
    expect(store.sessions[0]).toMatchObject({ endPage: page, pagesTotal: 300 });
    expect(await edit({ currentChapter: "II" })).toMatchObject({ currentPage: page });
    expect(store.writes.filter((w) => w.table === "readings")[0].values).toMatchObject({ totalPages: 300, startPage: 100, currentPage: page });
  });

  it.each(["reading", "paused", "finished", "abandoned"] as const)("preserves %s status and meaningful reader correction provenance in a combined save", async (status) => {
    store.reading.status = status; store.sessions[0].source = "reader";
    expect(await edit({ totalPages: 1200, currentPosition: { percent: 50 } })).toMatchObject({ status, currentPage: 600 });
    expect(store.sessions[0]).toMatchObject({ endPage: 600, source: "manual" });
  });

  it("keeps chapter-only and unchanged canonical fields from becoming reader position corrections", async () => {
    store.sessions[0].source = "reader";
    const history = { ...store.sessions[0] };
    expect(await edit({ totalPages: 1200, currentPosition: { percent: 25 }, currentChapter: "II" })).toMatchObject({ currentPage: 300, currentPercent: 25, currentChapter: "II" });
    expect(store.sessions[0]).toMatchObject({ source: "reader", endPage: history.endPage, endPercent: history.endPercent, pagesTotal: history.pagesTotal });
    expect(await edit({ currentChapter: null })).toMatchObject({ currentPage: 300, currentPercent: 25, currentChapter: null });
  });

  it.each(["minutes", "percent"] as const)("corrects audio %s through the action and subsequent shared recomputation", async (unit) => {
    Object.assign(store.reading, { format: "audio", unit, totalMinutes: 600, startMinutes: 0, currentMinutes: 300 });
    Object.assign(store.sessions[0], { format: "audio", startMinutes: 0, endMinutes: 300 });
    const currentPosition = unit === "minutes" ? { minutes: 600 } : { percent: 75 };
    const minutes = unit === "minutes" ? 600 : 900;
    const percent = unit === "minutes" ? 50 : 75;
    expect(await edit({ totalMinutes: 1200, currentPosition })).toMatchObject({ currentMinutes: minutes, currentPercent: percent });
    expect(store.sessions[0]).toMatchObject({ endMinutes: minutes, endPercent: percent });
    expect(await edit({ currentChapter: "II" })).toMatchObject({ currentMinutes: minutes, currentPercent: percent });
    expect(await edit({ rating: 4 })).toMatchObject({ currentMinutes: minutes, currentPercent: percent });
  });

  it.each(["minutes", "percent"] as const)("retains audio %s authority through duration-only, chapter-only and metadata-only saves", async (unit) => {
    Object.assign(store.reading, { format: "audio", unit, totalMinutes: 600, startMinutes: 0, currentMinutes: 300 });
    Object.assign(store.sessions[0], { format: "audio", startMinutes: 0, endMinutes: 300 });
    const history = structuredClone(store.sessions);
    const expected = unit === "minutes" ? { currentMinutes: 300, currentPage: 150, currentPercent: 25 } : { currentMinutes: 600, currentPage: 300, currentPercent: 50 };
    expect(await edit({ totalMinutes: 1200 })).toMatchObject(expected);
    for (const chapter of ["II", null]) {
      expect(await edit({ currentChapter: chapter })).toMatchObject({ ...expected, currentChapter: chapter });
      expect(await edit({ rating: 4 })).toMatchObject({ ...expected, currentChapter: chapter });
      expect(store.sessions[0]).toMatchObject({ endMinutes: history[0].endMinutes, endPage: history[0].endPage, endPercent: history[0].endPercent, source: history[0].source, pagesTotal: history[0].pagesTotal });
    }
  });

  it("maps a combined edition/total/start/current correction into the log's historical edition", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    expect(await edit({ editionId: other, totalPages: 1200, startPercent: 10, currentPosition: { page: 900 } })).toMatchObject({ editionId: other, startPage: 120, currentPage: 900, currentPercent: 75 });
    expect(store.sessions[0]).toMatchObject({ editionId: ID, endPage: 450, endPercent: 75, pagesTotal: 600 });
    expect(await edit({ currentChapter: "II" })).toMatchObject({ currentPage: 900, currentPercent: 75 });
    expect(await edit({ rating: 4 })).toMatchObject({ currentPage: 900, currentPercent: 75 });
  });

  it("keeps named and cleared chapters on the reading when all reader logs are behind the tracking start", async () => {
    Object.assign(store.reading, { startPage: 400, startPercent: 66.67, currentPage: 400, currentPercent: 66.67 });
    Object.assign(store.sessions[0], { source: "reader", startPage: 400, startPercent: 66.67 });
    const history = structuredClone(store.sessions);
    for (const chapter of ["II", null]) {
      expect(await edit({ currentChapter: chapter })).toMatchObject({ currentPage: 400, currentPercent: 66.67, currentChapter: chapter });
      expect(await edit({ rating: 4 })).toMatchObject({ currentPage: 400, currentChapter: chapter });
      expect(store.sessions).toEqual(history);
    }
  });

  it("keeps ignored reader logs intact while a chapter-only edit targets the contributing log", async () => {
    const ignored = { ...store.sessions[0], id: "33333333-3333-4333-8333-333333333333", readOn: "2026-09-03", source: "reader" as const, endPage: 180, endPercent: 30 };
    store.sessions.push(ignored);
    expect(await edit({ totalPages: 1200, currentPosition: { percent: 25 }, currentChapter: "II" })).toMatchObject({ currentPage: 300, currentPercent: 25 });
    expect(store.sessions[0]).toMatchObject({ endPage: 300, source: "manual", endChapter: "II" });
    expect(store.sessions[1]).toMatchObject({ source: "reader", endPage: 180, endPercent: 30, endChapter: "I", pagesTotal: 600 });
    expect(await edit({ currentChapter: null })).toMatchObject({ currentPage: 300, currentPercent: 25, currentChapter: null });
  });

  it("derives a sessionless current place from the edited start when shrinking the total", async () => {
    store.sessions = [];
    Object.assign(store.reading, { startPage: 400, startPercent: 66.67, currentPage: 400, currentPercent: 66.67 });
    expect(await edit({ totalPages: 300, startPage: 100, currentChapter: "Opening" })).toMatchObject({ currentPage: 100, currentPercent: 33.33, startPage: 100, currentChapter: "Opening" });
    expect(store.writes.every((w) => w.table === "readings")).toBe(true);
  });

  it("replays a cross-edition print snapshot consistently through totals-only, chapter-only and metadata-only saves", async () => {
    Object.assign(store.sessions[0], { editionId: "33333333-3333-4333-8333-333333333333", pagesTotal: 400, endPage: 200 });
    const history = structuredClone(store.sessions);
    expect(await edit({ totalPages: 1200 })).toMatchObject({ currentPage: 600, currentPercent: 50 });
    for (const chapter of ["II", null]) {
      expect(await edit({ currentChapter: chapter })).toMatchObject({ currentPage: 600, currentPercent: 50, currentChapter: chapter });
      expect(await edit({ rating: 4 })).toMatchObject({ currentPage: 600, currentPercent: 50, currentChapter: chapter });
      expect(store.sessions[0]).toMatchObject({ editionId: history[0].editionId, pagesTotal: 400, endPage: 200, endPercent: 50, source: history[0].source, readOn: history[0].readOn, durationSeconds: history[0].durationSeconds, note: history[0].note, createdAt: history[0].createdAt });
    }
  });

  // Every initial save must agree with the existing status-aware service replay;
  // later non-position edits cannot move its counters. Test the Cartesian product
  // to catch action branches drifting from shared replay under changed totals.
  it.each(["reading", "paused", "finished", "abandoned"] as const)("keeps canonical prospective positions stable across all unit/edition/start/source branches for %s", async (status) => {
    const initial = snapshot();
    const position = (reading: ReadingWithFingerprint) => ({ page: reading.currentPage, percent: reading.currentPercent, minutes: reading.currentMinutes });
    for (const unit of ["pages", "minutes", "percent"] as const) {
      for (const crossEdition of [false, true]) {
        for (const behind of [false, true]) {
          for (const editStart of [false, true]) {
            store.reading = structuredClone(initial.reading); store.sessions = structuredClone(initial.sessions); store.writes = [];
            Object.assign(store.reading, { status, unit, format: unit === "minutes" ? "audio" : "print", totalMinutes: 600, startMinutes: 0, currentMinutes: 300 });
            Object.assign(store.sessions[0], { format: store.reading.format, startMinutes: 0, endMinutes: 300 });
            if (crossEdition) Object.assign(store.sessions[0], { editionId: "33333333-3333-4333-8333-333333333333", pagesTotal: 400, endPage: 200 });
            if (behind) {
              Object.assign(store.reading, { startPage: 400, startPercent: 66.67, startMinutes: 400, currentPage: 400, currentPercent: 66.67, currentMinutes: 400 });
              Object.assign(store.sessions[0], { source: "reader", startPage: crossEdition ? 267 : 400, startPercent: 66.67, startMinutes: 400 });
            }
            const endpoints = { ...store.sessions[0] };
            const reading = await edit({ totalPages: 1200, totalMinutes: 1200, ...(editStart ? { startPercent: 10 } : {}), rating: 3 });
            const saved = position(reading);
            // Closed readings intentionally freeze their recorded finish/abandon
            // position; recomputeQueries follows the same status rule.
            if (status === "reading" || status === "paused") {
              const canonical = planPositions(store.reading, sessionOrder(store.sessions)).position;
              expect(saved).toEqual({ page: canonical.page, percent: canonical.percent, minutes: canonical.minutes });
            }
            for (const chapter of ["II", null]) {
              expect(position(await edit({ currentChapter: chapter }))).toEqual(saved);
              expect(position(await edit({ rating: 4 }))).toEqual(saved);
            }
            expect(store.reading.status).toBe(status);
            expect(store.sessions[0]).toMatchObject({ editionId: endpoints.editionId, source: endpoints.source, pagesTotal: endpoints.pagesTotal, endPage: endpoints.endPage, endMinutes: endpoints.endMinutes, endPercent: endpoints.endPercent, readOn: endpoints.readOn, durationSeconds: endpoints.durationSeconds, note: endpoints.note, createdAt: endpoints.createdAt });
          }
        }
      }
    }
  });

  it.each([{ page: 0 }, { page: 100 }, { percent: 50 }, { minutes: 10 }])("refuses every explicit sessionless current edit atomically even with totals/start/metadata (%j)", async (currentPosition) => {
    store.sessions = []; Object.assign(store.reading, { currentPage: 0, currentPercent: 0 });
    const before = snapshot();
    await expect(edit({ totalPages: 300, totalMinutes: 120, startPage: 50, currentPosition, rating: 4 })).rejects.toThrow("Log progress once");
    expect(snapshot()).toEqual(before); expect(store.batches).toBe(0);
  });

  it("refuses stale or invalid combined input without applying metadata or session writes", async () => {
    const before = snapshot();
    await expect(edit({ totalPages: 300, currentPosition: { page: 301 }, rating: 4 })).rejects.toThrow("past the last page");
    expect(snapshot()).toEqual(before); expect(store.batches).toBe(0);
    store.race = true;
    await expect(edit({ totalPages: 1200, currentPosition: { percent: 50 }, rating: 4 })).rejects.toThrow("changed elsewhere");
    expect(snapshot()).toEqual(before); expect(store.writes).toEqual([]);
  });
});
