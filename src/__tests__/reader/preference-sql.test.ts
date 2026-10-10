import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  isPreferenceSnapshotConflict, PREFERENCE_STALE_SNAPSHOT,
  preferenceClassLockSQL, preferenceSnapshotGuardSQL, preferenceSnapshotSQL,
} from "@/lib/reader/presentation/preference-sql";
import type { PresentationRow } from "@/lib/reader/presentation/defaults";

const mocks = vi.hoisted(() => ({
  snapshot: [] as unknown[], returnedRows: [] as unknown[], cookie: undefined as string | undefined,
  batches: [] as unknown[][],
  execute: vi.fn<(query: unknown) => Promise<unknown>>(),
  atomic: vi.fn<(build: (on: unknown) => unknown[]) => Promise<unknown[]>>(),
  exists: vi.fn<(id: string) => Promise<boolean>>(),
}));
vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/lib/db/atomic", () => ({ atomic: mocks.atomic }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.cookie === undefined ? undefined : { value: mocks.cookie } }) }));
vi.mock("@/lib/ebooks/preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ebooks/preferences")>();
  return { ...actual, readerPreferenceBookExists: mocks.exists,
    readerPreferenceRowsQuery: (_on: unknown, ebookId: string | null) => ({ kind: "rows", ebookId }),
    getReaderPreferences: async (ebookId: string | null) => ({ ok: true, ebookId, rows: mocks.returnedRows }),
  };
});
import { adoptLegacyReaderSettings, resetReaderPreferences, updateReaderPreferences } from "@/lib/actions/reader-preferences";

const book = "8d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11";
const scope = { deviceClass: "desktop" as const, ebookId: book };
const dialect = new PgDialect();
const compile = (query: Parameters<typeof dialect.sqlToQuery>[0]) => dialect.sqlToQuery(query);
const stale = () => new Error("Failed query: secret SQL", { cause: { code: "P0001", message: PREFERENCE_STALE_SNAPSHOT } });

beforeEach(() => {
  mocks.snapshot = [];
  mocks.returnedRows = [{ ...scope, presentation: { fontSizePx: 22 } }];
  mocks.cookie = undefined;
  mocks.batches = [];
  mocks.exists.mockReset().mockResolvedValue(true);
  mocks.execute.mockReset().mockImplementation(async () => ({ rows: [{ snapshot: mocks.snapshot }] }));
  mocks.atomic.mockReset().mockImplementation(async (build) => {
    const on = {
      execute: (query: unknown) => ({ kind: "sql", query }),
      insert: () => ({ values: (value: unknown) => ({
        onConflictDoUpdate: (conflict: unknown) => ({ kind: "upsert", value, conflict }),
        onConflictDoNothing: (conflict: unknown) => ({ kind: "adopt", value, conflict }),
      }) }),
      delete: () => ({ where: (where: unknown) => ({ kind: "delete", where }) }),
    };
    const batch = build(on);
    mocks.batches.push(batch);
    return batch.map((_query, index) => index === batch.length - 1 ? mocks.returnedRows : { rows: [] });
  });
});

it("guards complete canonical JSON with microseconds and absence, rather than a JS timestamp or digest", () => {
  const query = compile(preferenceSnapshotSQL(scope));
  expect(query.sql).toContain("jsonb_agg");
  expect(query.sql).toContain("nulls first");
  expect(query.sql).toContain("HH24:MI:SS.US");
  expect(query.sql).toContain("'[]'::jsonb");
  expect(query.sql).not.toContain("md5");
  const expected = [{ id: "x", updatedAt: "2026-10-10T01:02:03.123456", presentation: { fontSizePx: 20 } }];
  const guard = compile(preferenceSnapshotGuardSQL(scope, expected));
  expect(guard.params).toContain(JSON.stringify(expected));
  expect(guard.params).toContain(PREFERENCE_STALE_SNAPSHOT);
  expect(guard.sql).toContain("::jsonb");
  const canonical = '[{"presentation":{"futureValue":9007199254740993}}]';
  expect(compile(preferenceSnapshotGuardSQL(scope, canonical)).params).toContain(canonical);
  expect(compile(preferenceClassLockSQL(scope)).params).toContain("reader-preferences:desktop");
});

it("locks, checks book existence, guards a fresh statement, writes and returns rows in one atomic batch", async () => {
  const reply = await updateReaderPreferences({ ...scope, ebookId: book.toUpperCase(), presentation: { fontSizePx: 22 } });
  expect(reply).toEqual({ ok: true, ...scope, rows: mocks.returnedRows });
  const batch = mocks.batches[0] as { kind: string; query?: Parameters<typeof compile>[0] }[];
  expect(compile(batch[0].query!).sql).toContain("pg_advisory_xact_lock");
  expect(compile(batch[1].query!).sql).toContain("exists(select 1 from ebooks");
  expect(compile(batch[2].query!).params).toContain(PREFERENCE_STALE_SNAPSHOT);
  expect(batch[3].kind).toBe("upsert");
  expect(batch[4]).toEqual({ kind: "rows", ebookId: book });
  expect(mocks.exists).toHaveBeenCalledWith(book);
});

it("rereads/remerges after only the identified stale assertion and bounds retries", async () => {
  mocks.atomic.mockRejectedValueOnce(stale());
  const result = await updateReaderPreferences({ ...scope, presentation: { fontSizePx: 22 } });
  expect(result.ok).toBe(true);
  expect(mocks.execute).toHaveBeenCalledTimes(2);
  mocks.atomic.mockReset().mockRejectedValue(stale());
  expect((await resetReaderPreferences(scope)).ok).toBe(false);
  expect(mocks.atomic).toHaveBeenCalledTimes(3);
  const otherAssertion = new Error("Failed query", { cause: { code: "P0001", message: "Different database rule." } });
  expect(isPreferenceSnapshotConflict(otherAssertion)).toBe(false);
  mocks.atomic.mockReset().mockRejectedValue(otherAssertion);
  expect(await resetReaderPreferences(scope)).toEqual({ ok: false, error: "Different database rule." });
  expect(mocks.atomic).toHaveBeenCalledTimes(1);
});

it("atomically clears default fields and deletes an emptied override", async () => {
  mocks.snapshot = [{ ...scope, id: book, updatedAt: "2026-10-10T01:02:03.123456", presentation: { fontSizePx: 24 } }];
  await updateReaderPreferences({ deviceClass: "desktop", ebookId: null, clearBookOverrideId: book, presentation: { fontSizePx: 22 } });
  expect(mocks.batches[0].slice(3).map((item) => (item as { kind: string }).kind)).toEqual(["upsert", "delete", "rows"]);
});

it("reads the real cookie, adopts first-wins, and respects a reset/existing-row winner", async () => {
  mocks.cookie = encodeURIComponent(JSON.stringify({ fontFamily: "sans", fontSize: 20, lineHeight: 1.6, margin: 8, textAlign: "left" }));
  await adoptLegacyReaderSettings(scope);
  const insert = mocks.batches[0].find((item) => (item as { kind: string }).kind === "adopt") as { value: PresentationRow };
  expect(insert.value.ebookId).toBeNull();
  expect(insert.value.presentation).toMatchObject({ font: "inter", marginPx: 32, textAlign: "start" });
  mocks.snapshot = [{ deviceClass: "desktop", ebookId: null, presentation: { font: "literata" } }];
  await adoptLegacyReaderSettings(scope);
  expect(mocks.batches[1].some((item) => (item as { kind: string }).kind === "adopt")).toBe(false);
});

it("refuses malformed scope/client legacy before DB work and reports an unavailable book", async () => {
  expect((await adoptLegacyReaderSettings({ ...scope, legacy: {} })).ok).toBe(false);
  expect((await updateReaderPreferences({ ...scope, presentation: {} })).ok).toBe(false);
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.atomic).not.toHaveBeenCalled();
  mocks.exists.mockResolvedValue(false);
  expect(await resetReaderPreferences(scope)).toEqual({ ok: false, error: "This eBook is no longer available." });
});
