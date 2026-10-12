import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPreferenceSaver, type PreferenceRecovery, type PreferenceTransport } from "@/lib/reader/presentation/preference-saver";
import type { PreferenceReply, PreferenceUpdate } from "@/lib/reader/presentation/preference-plan";
import { effectivePresentation } from "@/lib/reader/presentation/defaults";
import type { PresentationOverride } from "@/lib/validations/reader-preferences";

const book = "8d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11";
const other = "0d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11";
const scope = { deviceClass: "desktop" as const, ebookId: book };
function reply(ebookId: string | null = book, defaults: PresentationOverride = { fontSizePx: 20 }, override: PresentationOverride | null = { theme: "paper" }): PreferenceReply {
  return { ok: true, deviceClass: "desktop", ebookId, rows: [
    { deviceClass: "desktop", ebookId: null, presentation: defaults },
    ...(ebookId !== null && override !== null ? [{ deviceClass: "desktop" as const, ebookId, presentation: override }] : []),
  ] };
}
const initial = reply();
if (!initial.ok) throw new Error("Invalid test fixture.");
const initialRows = initial.rows;
const update = (presentation: PresentationOverride, ebookId: string | null = null) => ({ deviceClass: "desktop" as const, ebookId, presentation });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function transport() {
  return {
    adopt: vi.fn(async () => reply()),
    update: vi.fn(async (input: PreferenceUpdate) => reply(input.ebookId ?? input.clearBookOverrideId ?? null,
      input.ebookId === null ? { fontSizePx: 20, ...input.presentation } : { fontSizePx: 20 },
      { theme: "paper", ...(input.ebookId === book ? input.presentation : {}) })),
    reset: vi.fn(async () => reply(book, { fontSizePx: 20 }, null)),
  } satisfies PreferenceTransport;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("coalesces only unsent same-scope edits and waits 800ms after the last edit", async () => {
  const wire = transport();
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire });
  await saver.start();
  saver.update(update({ fontSizePx: 22 }));
  await vi.advanceTimersByTimeAsync(500);
  saver.update(update({ lineHeight: 1.8 }));
  await vi.advanceTimersByTimeAsync(799);
  expect(wire.update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(wire.update).toHaveBeenCalledTimes(1);
  expect(wire.update.mock.calls[0][0].presentation).toEqual({ fontSizePx: 22, lineHeight: 1.8 });
  expect(saver.getSnapshot().pending).toBe(0);
  expect(saver.getSnapshot().rows.find((row) => row.ebookId === book)?.presentation).toEqual({ theme: "paper" });
});

it("a late response acknowledges only its generation and cannot bypass a newer deadline", async () => {
  const first = deferred<PreferenceReply>();
  const wire = transport();
  wire.update.mockImplementationOnce(() => first.promise);
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire });
  await saver.start();
  saver.update(update({ fontSizePx: 22 }));
  await vi.advanceTimersByTimeAsync(800);
  const finishing = saver.flush();
  await vi.advanceTimersByTimeAsync(100);
  saver.update(update({ fontSizePx: 24 }));
  first.resolve(reply(null, { fontSizePx: 22 }));
  await finishing;
  expect(saver.getSnapshot().rows.find((row) => row.ebookId === null)?.presentation).toMatchObject({ fontSizePx: 24 });
  expect(saver.getSnapshot().pending).toBe(1);
  await vi.advanceTimersByTimeAsync(799);
  expect(wire.update).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(wire.update).toHaveBeenCalledTimes(2);
});

it("failure retains intent and retries only on a new edit or an explicit online flush", async () => {
  const wire = transport();
  wire.update.mockResolvedValueOnce({ ok: false, error: "Offline." });
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire });
  await saver.start();
  saver.update(update({ fontSizePx: 22 }, book.toUpperCase()));
  await saver.flush();
  expect(saver.getSnapshot()).toMatchObject({ pending: 1, error: "Offline." });
  await vi.advanceTimersByTimeAsync(10000);
  expect(wire.update).toHaveBeenCalledTimes(1);
  await saver.flush();
  expect(wire.update.mock.calls[1][0]).toMatchObject({ deviceClass: "desktop", ebookId: book });
  expect(saver.getSnapshot().pending).toBe(0);
});

it("serialises reset behind an in-flight edit and previews the later reset immediately", async () => {
  const first = deferred<PreferenceReply>();
  const wire = transport();
  wire.update.mockImplementationOnce(() => first.promise);
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire });
  await saver.start();
  saver.update(update({ fontSizePx: 24 }, book));
  await vi.advanceTimersByTimeAsync(800);
  const finishing = saver.flush();
  saver.reset(scope);
  expect(saver.getSnapshot().rows.some((row) => row.ebookId === book)).toBe(false);
  expect(wire.reset).not.toHaveBeenCalled();
  first.resolve(reply(book, { fontSizePx: 20 }, { fontSizePx: 24, theme: "paper" }));
  await finishing;
  expect(saver.getSnapshot().rows.some((row) => row.ebookId === book)).toBe(false);
  await vi.advanceTimersByTimeAsync(800);
  expect(wire.reset).toHaveBeenCalledTimes(1);
});

it("adopts before writes, keeps edits during adoption, and clears the cookie only after success", async () => {
  const adoption = deferred<PreferenceReply>();
  const wire = transport();
  wire.adopt.mockImplementationOnce(() => adoption.promise);
  const deleted = vi.fn();
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, onAdopted: deleted });
  const starting = saver.start();
  saver.update(update({ lineHeight: 1.8 }));
  expect(deleted).not.toHaveBeenCalled();
  expect(wire.update).not.toHaveBeenCalled();
  adoption.resolve(reply(book, { fontSizePx: 28 }));
  await starting;
  expect(deleted).toHaveBeenCalledTimes(1);
  expect(saver.getSnapshot().rows.find((row) => row.ebookId === null)?.presentation).toMatchObject({ fontSizePx: 28, lineHeight: 1.8 });
  await vi.advanceTimersByTimeAsync(800);
  expect(wire.update).toHaveBeenCalledTimes(1);
});

it("a failed adoption keeps the cookie and pending writes until a later retry", async () => {
  const wire = transport();
  wire.adopt.mockResolvedValueOnce({ ok: false, error: "Migration not ready." });
  const deleted = vi.fn();
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, onAdopted: deleted });
  saver.update(update({ fontSizePx: 22 }));
  await saver.start();
  expect(saver.getSnapshot()).toMatchObject({ ready: false, pending: 1 });
  expect(deleted).not.toHaveBeenCalled();
  expect(wire.update).not.toHaveBeenCalled();
  await saver.flush();
  expect(deleted).toHaveBeenCalledTimes(1);
  expect(wire.update).toHaveBeenCalledTimes(1);
});

it("rejects wrong outgoing and returned scopes without losing a generation", async () => {
  const wire = transport();
  wire.update.mockResolvedValueOnce(reply(other));
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire });
  await saver.start();
  expect(() => saver.update({ deviceClass: "phone", ebookId: book, presentation: { fontSizePx: 18 } })).toThrow();
  expect(() => saver.reset({ deviceClass: "desktop", ebookId: other })).toThrow();
  saver.update(update({ fontSizePx: 22 }));
  await saver.flush();
  expect(saver.getSnapshot().pending).toBe(1);
  expect(saver.getSnapshot().error).toContain("scope");
  expect(saver.getSnapshot().rows.some((row) => row.ebookId === other)).toBe(false);
});

it("pagehide dispatch remains pending/recoverable; a reload replays against fresh server rows", async () => {
  const inFlight = deferred<PreferenceReply>();
  const wire = transport();
  wire.update.mockImplementationOnce(() => inFlight.promise);
  let draft: PreferenceRecovery | null = null;
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, persistRecovery: (value) => { draft = value; } });
  await saver.start();
  saver.update(update({ fontSizePx: 22 }));
  const dispatch = saver.flush();
  expect(saver.getSnapshot()).toMatchObject({ pending: 1, recoverySaved: true, unloadRisk: true });
  const savedDraft = JSON.parse(JSON.stringify(draft));
  inFlight.resolve({ ok: false, error: "Page closed before acknowledgement." });
  await dispatch;
  expect(draft).not.toBeNull();
  const afterReload = transport();
  afterReload.adopt.mockResolvedValueOnce(reply(book, { fontSizePx: 30, lineHeight: 2 }));
  const resumed = createPreferenceSaver({ scope, initialRows, transport: afterReload, recovery: savedDraft });
  await resumed.start();
  expect(resumed.getSnapshot().rows.find((row) => row.ebookId === null)?.presentation).toMatchObject({ fontSizePx: 22, lineHeight: 2 });
  await resumed.flush();
  expect(afterReload.update.mock.calls[0][0].presentation).toEqual({ fontSizePx: 22 });
  expect(resumed.getSnapshot().unloadRisk).toBe(false);
});

it("keeps drafts immutable and reports storage failure rather than claiming recovery", async () => {
  const saver = createPreferenceSaver({ scope, initialRows, transport: transport(), persistRecovery: () => { throw new Error("Quota."); } });
  await saver.start();
  const input = update({ fontSizePx: 22 });
  saver.update(input);
  input.presentation.fontSizePx = 40;
  expect(saver.getSnapshot().rows.find((row) => row.ebookId === null)?.presentation).toMatchObject({ fontSizePx: 22 });
  expect(saver.getSnapshot()).toMatchObject({ pending: 1, recoverySaved: false, unloadRisk: true });
  expect(saver.getSnapshot().recoveryError).toContain("Keep the page open");
  await saver.flush();
});

it("does not replay a foreign or malformed recovery draft", async () => {
  const wire = transport();
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, recovery: {
    version: 1, scope: { ...scope, ebookId: other }, jobs: [{ kind: "update", input: update({ fontSizePx: 40 }, other) }],
  } });
  await saver.start();
  await vi.advanceTimersByTimeAsync(1000);
  expect(wire.update).not.toHaveBeenCalled();
  expect(saver.getSnapshot().recoveryError).toContain("not been submitted");
});

const recoveredDraft = () => ({ version: 1, scope, jobs: [{ kind: "update", input: update({ fontSizePx: 22 }) }] });

it("keeps recovered construction/discarded-render simulation inert until committed activation", async () => {
  const wire = transport();
  const deleted = vi.fn();
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, recovery: recoveredDraft(), onAdopted: deleted });
  await vi.advanceTimersByTimeAsync(2000);
  await saver.flush();
  expect(wire.adopt).not.toHaveBeenCalled();
  expect(wire.update).not.toHaveBeenCalled();
  expect(wire.reset).not.toHaveBeenCalled();
  expect(deleted).not.toHaveBeenCalled();
  expect(saver.getSnapshot().pending).toBe(1);
  await saver.start();
  expect(deleted).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(799);
  expect(wire.update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(wire.update).toHaveBeenCalledTimes(1);
});

it("simulates StrictMode setup/cleanup/setup without duplicate adoption or a reset deadline", async () => {
  const wire = transport();
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, recovery: recoveredDraft() });
  const discardedSetup = saver.start();
  saver.pause();
  await discardedSetup;
  await vi.advanceTimersByTimeAsync(400);
  expect(wire.adopt).not.toHaveBeenCalled();
  expect(wire.update).not.toHaveBeenCalled();
  await saver.start();
  expect(wire.adopt).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(399);
  expect(wire.update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(wire.update).toHaveBeenCalledTimes(1);
  saver.pause();
  await vi.advanceTimersByTimeAsync(2000);
  expect(wire.update).toHaveBeenCalledTimes(1);
});

it("cleanup retains a recovered draft and defers a late adoption cookie callback until remount", async () => {
  const adoption = deferred<PreferenceReply>();
  const entered = deferred<void>();
  const wire = transport();
  wire.adopt.mockImplementationOnce(() => { entered.resolve(); return adoption.promise; });
  const deleted = vi.fn();
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, recovery: recoveredDraft(), onAdopted: deleted });
  const starting = saver.start();
  await entered.promise;
  saver.pause();
  adoption.resolve(reply());
  await starting;
  await vi.advanceTimersByTimeAsync(2000);
  expect(deleted).not.toHaveBeenCalled();
  expect(wire.update).not.toHaveBeenCalled();
  expect(saver.getSnapshot().pending).toBe(1);
  await saver.start();
  expect(deleted).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(wire.update).toHaveBeenCalledTimes(1);
  expect(wire.adopt).toHaveBeenCalledTimes(1);
});


it("offline hard reload admits safe defaults without adoption, writes or cookie clearing", async () => {
  const wire = transport(), deleted = vi.fn(), acknowledged = vi.fn();
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, online: false,
    onAdopted: deleted, persistAcknowledged: acknowledged });
  await saver.start(); await saver.flush(); await vi.advanceTimersByTimeAsync(10000);
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 0 });
  expect(effectivePresentation("desktop", saver.getSnapshot().rows)).toMatchObject({ fontSizePx: 20, theme: "durtal-dark" });
  expect(wire.adopt).not.toHaveBeenCalled(); expect(wire.update).not.toHaveBeenCalled();
  expect(wire.reset).not.toHaveBeenCalled(); expect(deleted).not.toHaveBeenCalled();
  expect(acknowledged).not.toHaveBeenCalled();
});

it("offline cached settings and valid drafts preview together without becoming acknowledged", async () => {
  const wire = transport(), acknowledged = vi.fn();
  let draft: PreferenceRecovery | null = null;
  const cached = [{ deviceClass: "desktop" as const, ebookId: null, presentation: { fontSizePx: 28 } }];
  const saver = createPreferenceSaver({ scope, initialRows: [], transport: wire, online: false, cachedRows: cached,
    persistRecovery: value => { draft = value; }, persistAcknowledged: acknowledged });
  await saver.start(); saver.update(update({ lineHeight: 1.8 })); saver.reset(scope);
  await vi.advanceTimersByTimeAsync(10000); await saver.flush();
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 2, recoverySaved: true, unloadRisk: true });
  expect(effectivePresentation("desktop", saver.getSnapshot().rows)).toMatchObject({ fontSizePx: 28, lineHeight: 1.8 });
  expect(acknowledged).not.toHaveBeenCalled(); expect(wire.adopt).not.toHaveBeenCalled();
  expect(wire.update).not.toHaveBeenCalled(); expect(wire.reset).not.toHaveBeenCalled();
  const reload = createPreferenceSaver({ scope, initialRows: [], transport: wire, online: false, cachedRows: cached,
    recovery: JSON.parse(JSON.stringify(draft)) });
  await reload.start();
  expect(reload.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 2, recoverySaved: true });
  expect(effectivePresentation("desktop", reload.getSnapshot().rows)).toMatchObject({ fontSizePx: 28, lineHeight: 1.8 });
});

it("reconnect adopts real server rows before ordered update/reset replay and cookie clearing", async () => {
  const adoption = deferred<PreferenceReply>(), entered = deferred<void>();
  const wire = transport(), deleted = vi.fn(), acknowledged = vi.fn();
  wire.adopt.mockImplementationOnce(() => { entered.resolve(); return adoption.promise; });
  const saver = createPreferenceSaver({ scope, initialRows: [], transport: wire, online: false,
    cachedRows: [{ deviceClass: "desktop", ebookId: null, presentation: { fontSizePx: 28 } }],
    persistRecovery: () => {}, persistAcknowledged: acknowledged, onAdopted: deleted });
  await saver.start(); saver.update(update({ lineHeight: 1.8 })); saver.reset(scope);
  saver.setOnline(true); const reconnect = saver.flush(); await entered.promise;
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 2 });
  expect(wire.update).not.toHaveBeenCalled(); expect(wire.reset).not.toHaveBeenCalled();
  expect(deleted).not.toHaveBeenCalled();
  adoption.resolve(reply(book, { fontSizePx: 30 })); await reconnect;
  expect(deleted).toHaveBeenCalledTimes(1); expect(wire.adopt).toHaveBeenCalledTimes(1);
  expect(wire.update.mock.invocationCallOrder[0]).toBeLessThan(wire.reset.mock.invocationCallOrder[0]);
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: true, pending: 0, unloadRisk: false });
  expect(acknowledged).toHaveBeenCalledTimes(3);
  expect(acknowledged.mock.calls[0][0].find((row: { ebookId: string | null }) => row.ebookId === null).presentation).toEqual({ fontSizePx: 30 });
});

it("failed reconnect adoption preserves local reading, cookie, drafts and visible failure", async () => {
  const wire = transport(), deleted = vi.fn();
  wire.adopt.mockResolvedValueOnce({ ok: false, error: "Server unavailable." });
  const saver = createPreferenceSaver({ scope, initialRows: [], transport: wire, online: false,
    persistRecovery: () => {}, onAdopted: deleted });
  await saver.start(); saver.update(update({ fontSizePx: 24 })); saver.setOnline(true); await saver.flush();
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 1, recoverySaved: true, error: "Server unavailable." });
  expect(wire.update).not.toHaveBeenCalled(); expect(deleted).not.toHaveBeenCalled();
  await saver.flush(); expect(wire.update).toHaveBeenCalledTimes(1); expect(deleted).toHaveBeenCalledTimes(1);
});

it("late offline write acknowledgement removes only its generation and reconnect readopts", async () => {
  const write = deferred<PreferenceReply>(), entered = deferred<void>();
  const wire = transport(); wire.update.mockImplementationOnce(() => { entered.resolve(); return write.promise; });
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, persistRecovery: () => {} });
  await saver.start(); saver.update(update({ fontSizePx: 22 })); const dispatch = saver.flush(); await entered.promise;
  saver.setOnline(false); saver.update(update({ fontSizePx: 24 }));
  write.resolve(reply(null, { fontSizePx: 22 })); await dispatch;
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 1, recoverySaved: true });
  expect(effectivePresentation("desktop", saver.getSnapshot().rows).fontSizePx).toBe(24);
  await vi.advanceTimersByTimeAsync(10000); expect(wire.update).toHaveBeenCalledTimes(1);
  saver.setOnline(true); await saver.flush();
  expect(wire.adopt).toHaveBeenCalledTimes(2); expect(wire.update).toHaveBeenCalledTimes(2);
  expect(wire.update.mock.calls[1][0].presentation).toEqual({ fontSizePx: 24 });
  expect(saver.getSnapshot().pending).toBe(0);
});

it("an adoption dispatched before offline cannot clear the cookie or authorize reconnect writes", async () => {
  const adoption = deferred<PreferenceReply>(), entered = deferred<void>();
  const wire = transport(), deleted = vi.fn();
  wire.adopt.mockImplementationOnce(() => { entered.resolve(); return adoption.promise; });
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, onAdopted: deleted, persistRecovery: () => {} });
  const opening = saver.start(); await entered.promise; saver.setOnline(false); saver.update(update({ fontSizePx: 24 }));
  adoption.resolve(reply()); await opening;
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 1 });
  expect(deleted).not.toHaveBeenCalled(); expect(wire.update).not.toHaveBeenCalled();
  saver.setOnline(true); await saver.flush();
  expect(wire.adopt).toHaveBeenCalledTimes(2); expect(deleted).toHaveBeenCalledTimes(1);
  expect(wire.update).toHaveBeenCalledTimes(1);
});

it("a connectivity epoch change waits for the old adoption then requires a fresh one", async () => {
  const adoption = deferred<PreferenceReply>(), entered = deferred<void>();
  const wire = transport(), deleted = vi.fn();
  wire.adopt.mockImplementationOnce(() => { entered.resolve(); return adoption.promise; });
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, onAdopted: deleted });
  const opening = saver.start(); await entered.promise; saver.setOnline(false); saver.setOnline(true);
  const reconnect = saver.flush(); adoption.resolve(reply()); await opening; await reconnect;
  expect(wire.adopt).toHaveBeenCalledTimes(2); expect(deleted).toHaveBeenCalledTimes(1);
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: true });
});

it("rejects malformed reply values without acknowledging a pending job", async () => {
  const wire = transport();
  wire.update.mockResolvedValueOnce({ ok: true, ...scope,
    rows: [{ ...scope, presentation: { fontSizePx: 999 } }] });
  const saver = createPreferenceSaver({ scope, initialRows, transport: wire, persistRecovery: () => {} });
  await saver.start(); saver.update(update({ fontSizePx: 24 }, book)); await saver.flush();
  expect(saver.getSnapshot()).toMatchObject({ pending: 1, recoverySaved: true });
  expect(saver.getSnapshot().error).not.toBeNull();
  expect(effectivePresentation("desktop", saver.getSnapshot().rows).fontSizePx).toBe(24);
});

it("foreign cached rows/drafts and oversized recovery cannot contaminate offline defaults", async () => {
  const wire = transport();
  for (const recovery of [
    { version: 1, scope: { ...scope, ebookId: other }, jobs: [{ kind: "update", input: update({ fontSizePx: 40 }, other) }] },
    { version: 1, scope, jobs: [{ kind: "update", input: { ...update({ fontSizePx: 24 }), surprise: "x".repeat(65537) } }] },
  ]) {
    const saver = createPreferenceSaver({ scope, initialRows: [], transport: wire, online: false, recovery,
      cachedRows: [{ deviceClass: "phone", ebookId: other, presentation: { fontSizePx: 40 } }] });
    await saver.start();
    expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 0 });
    expect(saver.getSnapshot().recoveryError).not.toBeNull();
    expect(effectivePresentation("desktop", saver.getSnapshot().rows).fontSizePx).toBe(20);
  }
  expect(wire.adopt).not.toHaveBeenCalled(); expect(wire.update).not.toHaveBeenCalled();
});

it("offline storage failure warns without claiming draft or acknowledgement durability", async () => {
  const wire = transport();
  const saver = createPreferenceSaver({ scope, initialRows: [], transport: wire, online: false,
    cacheError: "Saved reading settings unavailable.", persistRecovery: () => { throw new Error("Quota."); } });
  await saver.start(); saver.update(update({ fontSizePx: 24 }));
  expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 1, recoverySaved: false, unloadRisk: true });
  expect(saver.getSnapshot().recoveryError).toContain("Keep the page open");
  expect(wire.update).not.toHaveBeenCalled();
});

it("wrong-scope or invalid reconnect adoption never authorizes draft replay or cookie clearing", async () => {
  for (const badReply of [reply(other), { ok: true as const, ...scope,
    rows: [{ ...scope, presentation: { fontSizePx: 999 } }] }]) {
    const wire = transport(), deleted = vi.fn(); wire.adopt.mockResolvedValueOnce(badReply);
    const saver = createPreferenceSaver({ scope, initialRows: [], transport: wire, online: false,
      onAdopted: deleted, persistRecovery: () => {} });
    await saver.start(); saver.update(update({ fontSizePx: 24 })); saver.setOnline(true); await saver.flush();
    expect(saver.getSnapshot()).toMatchObject({ ready: true, serverAdopted: false, pending: 1, recoverySaved: true });
    expect(saver.getSnapshot().error).not.toBeNull(); expect(deleted).not.toHaveBeenCalled();
    expect(wire.update).not.toHaveBeenCalled();
    expect(saver.getSnapshot().rows.some(row => row.ebookId === other)).toBe(false);
    saver.pause();
  }
});

it("durable commit is reported only for the latest draft snapshot, never a late storage completion", async () => {
  const first = deferred<void>(), second = deferred<void>();
  const wire = transport(); const persist = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const saver = createPreferenceSaver({ scope, initialRows: [], transport: wire, online: false, persistRecovery: persist });
  await saver.start(); saver.update(update({ fontSizePx: 22 })); saver.update(update({ fontSizePx: 24 }));
  expect(saver.getSnapshot()).toMatchObject({ pending: 1, recoverySaved: false, unloadRisk: true });
  first.resolve(); await first.promise;
  expect(saver.getSnapshot().recoverySaved).toBe(false);
  second.resolve(); await saver.flush();
  expect(saver.getSnapshot()).toMatchObject({ pending: 1, recoverySaved: true, serverAdopted: false });
  expect(wire.adopt).not.toHaveBeenCalled(); expect(wire.update).not.toHaveBeenCalled();
});
