import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPreferenceSaver, type PreferenceRecovery, type PreferenceTransport } from "@/lib/reader/presentation/preference-saver";
import type { PreferenceReply, PreferenceUpdate } from "@/lib/reader/presentation/preference-plan";
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
  await saver.flush();
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
