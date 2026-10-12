import { expect, it, vi } from "vitest";
import { boundedPreferenceJson, boundedPreferenceString, MAX_PREFERENCE_STORAGE_CHARS,
  createDurablePreferenceDraft, parsePreferenceCache, preferenceCacheKey, serializePreferenceCache, preferenceDraftKey, type DraftLock } from "@/lib/reader/presentation/preference-cache";

import { effectivePresentation } from "@/lib/reader/presentation/defaults";
import { type PreferenceReply, type PreferenceUpdate } from "@/lib/reader/presentation/preference-plan";
import { createPreferenceSaver } from "@/lib/reader/presentation/preference-saver";
const scope = { deviceClass: "desktop" as const, ebookId: "8d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11" };
const rows = [{ deviceClass: "desktop" as const, ebookId: null, presentation: { fontSizePx: 28 } },
  { ...scope, presentation: { theme: "paper" } }];
it("stores only validated acknowledged settings for the exact book and device class", () => {
  const raw = serializePreferenceCache(scope, [...rows, { deviceClass: "phone", ebookId: null, presentation: { fontSizePx: 18 } }]);
  const read = parsePreferenceCache(raw, scope);
  expect(read).toEqual(rows); expect(Object.isFrozen(read)).toBe(true);
  expect(Object.isFrozen(read[0].presentation)).toBe(true);
  expect(preferenceCacheKey(scope)).not.toBe(preferenceCacheKey({ ...scope, deviceClass: "phone" }));
  expect(preferenceCacheKey(scope)).not.toBe(preferenceCacheKey({ ...scope, ebookId: null }));
});
it("refuses wrong versions, scopes, duplicate rows, malicious values and extra fields", () => {
  const valid = { version: 1, scope, rows };
  for (const cache of [
    { ...valid, version: 2 }, { ...valid, scope: { ...scope, ebookId: null } },
    { ...valid, scope: { ...scope, deviceClass: "phone" } }, { ...valid, rows: [rows[0], rows[0]] },
    { ...valid, rows: [{ ...rows[0], deviceClass: "phone" }] },
    { ...valid, rows: [{ ...rows[1], ebookId: "0d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11" }] },
    { ...valid, rows: [{ ...rows[0], presentation: { fontSizePx: 999 } }] },
    { ...valid, rows: [{ ...rows[0], presentation: { font: "javascript:alert(1)" } }] },
    { ...valid, jobs: [] }, { ...valid, rows: [{ ...rows[0], presentation: { unknown: true } }] },
  ]) expect(() => parsePreferenceCache(JSON.stringify(cache), scope)).toThrow();
  expect(() => parsePreferenceCache('{"version":1,"scope":null,"rows":[]}', scope)).toThrow();
});
it("bounds stored snapshots and draft JSON before parsing or writing", () => {
  expect(() => boundedPreferenceJson(" ".repeat(MAX_PREFERENCE_STORAGE_CHARS + 1))).toThrow("too large");
  expect(() => boundedPreferenceString({ text: "x".repeat(MAX_PREFERENCE_STORAGE_CHARS) })).toThrow("too large");
  expect(() => parsePreferenceCache("x".repeat(MAX_PREFERENCE_STORAGE_CHARS + 1), scope)).toThrow("too large");
  expect(() => boundedPreferenceJson("{" )).toThrow();
});


const writerA = "11111111-1111-4111-8111-111111111111", writerB = "22222222-2222-4222-8222-222222222222";
function durableFixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  let queue = Promise.resolve();
  const lock: DraftLock = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  return { data, storage, lock };
}
const offlineDraft = () => ({ version: 1, scope, jobs: [
  { kind: "update", input: { ...scope, presentation: { fontSizePx: 24 } } },
  { kind: "reset", input: scope },
] });
it("a fresh session/controller recovers durable offline update/reset without session storage", async () => {
  const { storage, lock } = durableFixture();
  const first = createDurablePreferenceDraft(scope, storage, lock, writerA);
  await first.persist(offlineDraft());
  // Only the durable origin store survives; no tab/session draft is supplied.
  const fresh = createDurablePreferenceDraft(scope, storage, lock, writerB);
  expect(fresh.recovery).toEqual(offlineDraft());
  const wire = { adopt: vi.fn(), update: vi.fn(), reset: vi.fn() };
  const resumed = createPreferenceSaver({ scope, initialRows: [], transport: wire, online: false,
    recovery: fresh.recovery, persistRecovery: fresh.persist });
  await resumed.start(); await resumed.flush();
  expect(resumed.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 2, recoverySaved: true });
  expect(wire.adopt).not.toHaveBeenCalled(); expect(wire.update).not.toHaveBeenCalled(); expect(wire.reset).not.toHaveBeenCalled();
  expect(JSON.parse(storage.getItem(preferenceDraftKey(scope))!).owner).toBe(writerB);
  resumed.pause();
});
it("exclusive ownership and exact snapshot comparison preserve another writer's newer pending draft", async () => {
  const { storage, lock } = durableFixture();
  const first = createDurablePreferenceDraft(scope, storage, lock, writerA); await first.persist(offlineDraft());
  const second = createDurablePreferenceDraft(scope, storage, lock, writerB);
  const newer = { ...offlineDraft(), jobs: [...offlineDraft().jobs,
    { kind: "update", input: { ...scope, presentation: { fontSizePx: 28 } } }] };
  await second.persist(newer); const saved = storage.getItem(preferenceDraftKey(scope));
  await expect(first.persist(null)).rejects.toThrow("another tab");
  await expect(first.persist(offlineDraft())).rejects.toThrow("another tab");
  expect(storage.getItem(preferenceDraftKey(scope))).toBe(saved);
  expect(createDurablePreferenceDraft(scope, storage, lock, writerA).recovery).toEqual(newer);
});
it("malformed, foreign and oversized durable drafts are never adopted or replayed", () => {
  const { storage, lock } = durableFixture();
  for (const draft of [
    { ...offlineDraft(), scope: { ...scope, ebookId: null } },
    { ...offlineDraft(), jobs: [{ kind: "update", input: { ...scope, deviceClass: "phone", presentation: { fontSizePx: 24 } } }] },
    { ...offlineDraft(), jobs: [{ kind: "update", input: { ...scope, presentation: { fontSizePx: 999 } } }] },
  ]) {
    storage.setItem(preferenceDraftKey(scope), JSON.stringify({ version: 1, owner: writerA, draft }));
    expect(createDurablePreferenceDraft(scope, storage, lock, writerB).recovery).toEqual({ unavailable: true });
  }
  storage.setItem(preferenceDraftKey(scope), "x".repeat(MAX_PREFERENCE_STORAGE_CHARS + 1));
  expect(createDurablePreferenceDraft(scope, storage, lock, writerB).recovery).toEqual({ unavailable: true });
});
it("missing scope locks and local storage failure never claim durable commit", async () => {
  const { storage, lock } = durableFixture();
  await expect(createDurablePreferenceDraft(scope, storage, undefined, writerA).persist(offlineDraft())).rejects.toThrow("unavailable");
  const failed = { ...storage, setItem: () => { throw new Error("Quota."); } };
  await expect(createDurablePreferenceDraft(scope, failed, lock, writerA).persist(offlineDraft())).rejects.toThrow("Quota");
  expect(storage.getItem(preferenceDraftKey(scope))).toBeNull();
});

it("clearing acknowledged jobs retains an empty durable authority over any stale session copy", async () => {
  const { storage, lock } = durableFixture();
  const first = createDurablePreferenceDraft(scope, storage, lock, writerA);
  await first.persist(offlineDraft()); await first.persist(null);
  const reload = createDurablePreferenceDraft(scope, storage, lock, writerB);
  expect(reload.recovery).toEqual({ version: 1, scope, jobs: [] });
  expect(reload.recovery).not.toBeUndefined();
});
it("durable storage rejection surfaces a saver warning without offline mutation traffic", async () => {
  const { storage, lock } = durableFixture();
  const failed = { ...storage, setItem: () => { throw new Error("Quota."); } };
  const durable = createDurablePreferenceDraft(scope, failed, lock, writerA);
  const wire = { adopt: vi.fn(), update: vi.fn(), reset: vi.fn() };
  const saver = createPreferenceSaver({ scope, initialRows: [], transport: wire, online: false, persistRecovery: durable.persist });
  await saver.start(); saver.update({ ...scope, presentation: { fontSizePx: 24 } }); await saver.flush();
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 1, recoverySaved: false, unloadRisk: true });
  expect(saver.getSnapshot().recoveryError).toContain("Keep the page open");
  expect(wire.adopt).not.toHaveBeenCalled(); expect(wire.update).not.toHaveBeenCalled(); expect(wire.reset).not.toHaveBeenCalled();
});

function matchingReply(fontSizePx: number): PreferenceReply {
  return { ok: true, ...scope, rows: [{ ...scope, presentation: { fontSizePx } }] };
}
it("a delayed old saver write reply cannot replace a newer owner's genuinely acknowledged cache", async () => {
  const { storage, lock } = durableFixture();
  const durableA = createDurablePreferenceDraft(scope, storage, lock, writerA);
  let release!: (reply: PreferenceReply) => void, entered!: () => void;
  const dispatched = new Promise<void>(done => { entered = done; });
  const wireA = { adopt: vi.fn(async () => matchingReply(20)), reset: vi.fn(),
    update: vi.fn(() => new Promise<PreferenceReply>(done => { release = done; entered(); })) };
  const first = createPreferenceSaver({ scope, initialRows: [], transport: wireA,
    persistRecovery: durableA.persist, persistAcknowledged: durableA.persistAcknowledged });
  await first.start(); first.update({ ...scope, presentation: { fontSizePx: 22 } });
  const lateWrite = first.flush(); await dispatched;
  const durableB = createDurablePreferenceDraft(scope, storage, lock, writerB);
  const wireB = { adopt: vi.fn(async () => matchingReply(22)), reset: vi.fn(),
    update: vi.fn(async (input: PreferenceUpdate) => matchingReply(input.presentation.fontSizePx!)) };
  const second = createPreferenceSaver({ scope, initialRows: [], transport: wireB, recovery: durableB.recovery,
    persistRecovery: durableB.persist, persistAcknowledged: durableB.persistAcknowledged });
  const opening = second.start(); second.update({ ...scope, presentation: { fontSizePx: 24 } });
  await opening; await second.flush();
  const newerDraft = storage.getItem(preferenceDraftKey(scope)), newerCache = storage.getItem(preferenceCacheKey(scope));
  expect(second.getSnapshot()).toMatchObject({ serverAdopted: true, pending: 0, recoveryError: null });
  expect(JSON.parse(newerDraft!).owner).toBe(writerB); expect(JSON.parse(newerDraft!).draft.jobs).toEqual([]);
  expect(parsePreferenceCache(newerCache!, scope)[0].presentation).toHaveProperty("fontSizePx", 24);
  release(matchingReply(22)); await lateWrite;
  // A received a real reply and settles only its generation; local ownership is still B's.
  expect(first.getSnapshot()).toMatchObject({ pending: 0, recoverySaved: false });
  expect(first.getSnapshot().recoveryError).toContain("another tab");
  expect(storage.getItem(preferenceDraftKey(scope))).toBe(newerDraft);
  expect(storage.getItem(preferenceCacheKey(scope))).toBe(newerCache);
  const freshDurable = createDurablePreferenceDraft(scope, storage, lock, writerA);
  const offlineWire = { adopt: vi.fn(), update: vi.fn(), reset: vi.fn() };
  const fresh = createPreferenceSaver({ scope, initialRows: [], transport: offlineWire, online: false,
    cachedRows: parsePreferenceCache(newerCache!, scope), recovery: freshDurable.recovery,
    persistRecovery: freshDurable.persist, persistAcknowledged: freshDurable.persistAcknowledged });
  await fresh.start(); await fresh.flush();
  expect(fresh.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 0 });
  expect(effectivePresentation("desktop", fresh.getSnapshot().rows).fontSizePx).toBe(24);
  expect(offlineWire.adopt).not.toHaveBeenCalled(); expect(offlineWire.update).not.toHaveBeenCalled();
  first.pause(); second.pause(); fresh.pause();
});
it("a delayed old adoption with no pending draft cannot overwrite a newer adopted cache", async () => {
  const { storage, lock } = durableFixture();
  const durableA = createDurablePreferenceDraft(scope, storage, lock, writerA);
  let release!: (reply: PreferenceReply) => void, entered!: () => void;
  const dispatched = new Promise<void>(done => { entered = done; });
  const wireA = { adopt: vi.fn(() => new Promise<PreferenceReply>(done => { release = done; entered(); })), update: vi.fn(), reset: vi.fn() };
  const first = createPreferenceSaver({ scope, initialRows: [], transport: wireA,
    persistRecovery: durableA.persist, persistAcknowledged: durableA.persistAcknowledged });
  const lateAdoption = first.start(); await dispatched;
  const durableB = createDurablePreferenceDraft(scope, storage, lock, writerB);
  const wireB = { adopt: vi.fn(async () => matchingReply(24)), update: vi.fn(), reset: vi.fn() };
  const second = createPreferenceSaver({ scope, initialRows: [], transport: wireB,
    persistRecovery: durableB.persist, persistAcknowledged: durableB.persistAcknowledged });
  await second.start();
  const newerDraft = storage.getItem(preferenceDraftKey(scope)), newerCache = storage.getItem(preferenceCacheKey(scope));
  release(matchingReply(22)); await lateAdoption;
  expect(first.getSnapshot()).toMatchObject({ serverAdopted: true, pending: 0, recoverySaved: false });
  expect(first.getSnapshot().recoveryError).toContain("another tab");
  expect(storage.getItem(preferenceDraftKey(scope))).toBe(newerDraft);
  expect(storage.getItem(preferenceCacheKey(scope))).toBe(newerCache);
  expect(parsePreferenceCache(newerCache!, scope)[0].presentation).toHaveProperty("fontSizePx", 24);
  first.pause(); second.pause();
});
it("acknowledged cache quota failure is reported while the owned pending draft stays recoverable", async () => {
  const { storage, lock } = durableFixture();
  const failed = { ...storage, setItem: (key: string, value: string) => {
    if (key === preferenceCacheKey(scope)) throw new Error("Cache quota.");
    storage.setItem(key, value);
  } };
  const durable = createDurablePreferenceDraft(scope, failed, lock, writerA);
  await durable.persist(offlineDraft()); const savedDraft = storage.getItem(preferenceDraftKey(scope));
  await expect(durable.persistAcknowledged(rows)).rejects.toThrow("Cache quota");
  expect(storage.getItem(preferenceDraftKey(scope))).toBe(savedDraft);
  expect(storage.getItem(preferenceCacheKey(scope))).toBeNull();
  const wire = { adopt: vi.fn(async () => matchingReply(24)), update: vi.fn(), reset: vi.fn() };
  const saver = createPreferenceSaver({ scope, initialRows: [], transport: wire,
    persistAcknowledged: durable.persistAcknowledged });
  await saver.start();
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: true, pending: 0 });
  expect(saver.getSnapshot().recoveryError).toContain("could not keep acknowledged");
  expect(storage.getItem(preferenceDraftKey(scope))).toBe(savedDraft);
  saver.pause();
});
