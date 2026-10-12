// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement as h, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
const actions = vi.hoisted(() => ({ adopt: vi.fn(), update: vi.fn(), reset: vi.fn() }));
vi.mock("@/lib/actions/reader-preferences", () => ({ adoptLegacyReaderSettings: actions.adopt,
  updateReaderPreferences: actions.update, resetReaderPreferences: actions.reset }));
import { useReaderPreferences } from "@/hooks/use-reader-preferences";
import { preferenceCacheKey, parsePreferenceCache, serializePreferenceCache, preferenceDraftKey } from "@/lib/reader/presentation/preference-cache";
import { effectivePresentation, type PresentationRow } from "@/lib/reader/presentation/defaults";
import { applyPreferenceChanges, planPreferenceReset, planPreferenceUpdate,
  type PreferenceReply, type PreferenceScope, type PreferenceUpdate } from "@/lib/reader/presentation/preference-plan";
import { READER_SETTINGS_KEY } from "@/lib/preferences";

let root: Root, host: HTMLElement, scope: PreferenceScope, connected: boolean;
let latest: ReturnType<typeof useReaderPreferences>;
let serverRows: readonly PresentationRow[];
let sequence = 0;
let previousLocks: PropertyDescriptor | undefined;
const emptyRows: readonly PresentationRow[] = [];
const draftKey = (value: PreferenceScope) => `durtal-reader-preference-draft:v1:${value.deviceClass}:${value.ebookId ?? "defaults"}`;
const reply = (value: PreferenceScope): PreferenceReply => ({ ok: true, ...value, rows: serverRows });
function Probe({ value, localPreferenceAdmission = true }: { value: PreferenceScope; localPreferenceAdmission?: boolean }) {
  latest = useReaderPreferences({ ...value, initialRows: emptyRows, localPreferenceAdmission });
  return h("p", null, latest.ready ? "ready" : "opening");
}
async function render(value = scope, strict = false, localPreferenceAdmission = true) {
  await act(async () => root.render(strict ? h(StrictMode, null, h(Probe, { value, localPreferenceAdmission }))
    : h(Probe, { value, localPreferenceAdmission })));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scope = { deviceClass: "desktop", ebookId: `8d2b2c8e-1f0a-4f6e-9a51-${(++sequence).toString(16).padStart(12, "0")}` };
  connected = false; vi.spyOn(navigator, "onLine", "get").mockImplementation(() => connected);
  localStorage.clear(); sessionStorage.clear();
  previousLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: async (_name: string, operation: () => void) => operation(),
  } });
  document.cookie = `${READER_SETTINGS_KEY}=kept; Path=/`;
  serverRows = [{ deviceClass: "desktop", ebookId: null, presentation: { fontSizePx: 30 } }];
  actions.adopt.mockImplementation(async (value: PreferenceScope) => reply(value));
  actions.update.mockImplementation(async (input: PreferenceUpdate) => {
    serverRows = applyPreferenceChanges(serverRows, planPreferenceUpdate(serverRows, input));
    return reply({ deviceClass: input.deviceClass, ebookId: input.ebookId ?? input.clearBookOverrideId ?? null });
  });
  actions.reset.mockImplementation(async (value: PreferenceScope) => {
    serverRows = applyPreferenceChanges(serverRows, planPreferenceReset(value)); return reply(value);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  document.cookie = `${READER_SETTINGS_KEY}=; Path=/; Max-Age=0`;
  if (previousLocks) Object.defineProperty(navigator, "locks", previousLocks);
  else delete (navigator as unknown as { locks?: unknown }).locks;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
it("committed offline StrictMode mount needs no server action and keeps the legacy cookie", async () => {
  await render(scope, true); await act(async () => { await latest.flush(); await vi.advanceTimersByTimeAsync(10000); });
  expect(latest).toMatchObject({ ready: true, serverAdopted: false, pending: 0 });
  expect(effectivePresentation("desktop", latest.rows)).toMatchObject({ fontSizePx: 20, theme: "durtal-dark" });
  expect(actions.adopt).not.toHaveBeenCalled(); expect(actions.update).not.toHaveBeenCalled(); expect(actions.reset).not.toHaveBeenCalled();
  expect(document.cookie).toContain(`${READER_SETTINGS_KEY}=kept`);
});
it("reads acknowledged local settings and a scoped draft, then genuinely adopts/replays online", async () => {
  localStorage.setItem(preferenceCacheKey(scope), serializePreferenceCache(scope,
    [{ ...scope, presentation: { fontSizePx: 28 } }]));
  sessionStorage.setItem(draftKey(scope), JSON.stringify({ version: 1, scope, jobs: [
    { kind: "update", input: { ...scope, presentation: { lineHeight: 1.8 } } },
  ] }));
  await render(scope, true);
  expect(effectivePresentation("desktop", latest.rows)).toMatchObject({ fontSizePx: 28, lineHeight: 1.8 });
  expect(latest).toMatchObject({ ready: true, serverAdopted: false, pending: 1, recoverySaved: true });
  expect(actions.adopt).not.toHaveBeenCalled();
  await act(async () => { latest.update({ ...scope, presentation: { fontSizePx: 24 } }); await latest.flush(); });
  expect(JSON.parse(localStorage.getItem(preferenceDraftKey(scope))!).draft.jobs[0].input.presentation).toEqual({ lineHeight: 1.8, fontSizePx: 24 });
  expect(parsePreferenceCache(localStorage.getItem(preferenceCacheKey(scope))!, scope)[0].presentation).toEqual({ fontSizePx: 28 });
  expect(actions.update).not.toHaveBeenCalled();
  await act(async () => { connected = true; window.dispatchEvent(new Event("online")); await latest.flush(); });
  expect(actions.adopt).toHaveBeenCalledTimes(1); expect(actions.update).toHaveBeenCalledTimes(1);
  expect(actions.adopt.mock.invocationCallOrder[0]).toBeLessThan(actions.update.mock.invocationCallOrder[0]);
  expect(latest).toMatchObject({ ready: true, serverAdopted: true, pending: 0 });
  expect(sessionStorage.getItem(draftKey(scope))).toBeNull();
  expect(JSON.parse(localStorage.getItem(preferenceDraftKey(scope))!).draft.jobs).toEqual([]);
  expect(document.cookie).not.toContain(`${READER_SETTINGS_KEY}=kept`);
  expect(parsePreferenceCache(localStorage.getItem(preferenceCacheKey(scope))!, scope).find(row => row.ebookId === scope.ebookId)?.presentation)
    .toEqual({ lineHeight: 1.8, fontSizePx: 24 });
});
it("changing book/class cannot borrow another scope's cache or late write acknowledgement", async () => {
  connected = true; await render();
  let resolve!: (reply: PreferenceReply) => void;
  let entered!: () => void;
  const started = new Promise<void>(done => { entered = done; });
  const oldScope = scope;
  actions.update.mockImplementationOnce(() => new Promise<PreferenceReply>(done => { resolve = done; entered(); }));
  let dispatched!: Promise<void>;
  await act(async () => { latest.update({ ...oldScope, presentation: { fontSizePx: 24 } }); dispatched = latest.flush(); await started; });
  const next: PreferenceScope = { deviceClass: "phone", ebookId: "0d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11" };
  localStorage.setItem(preferenceCacheKey(next), serializePreferenceCache(next, [{ ...next, presentation: { fontSizePx: 26 } }]));
  await act(async () => { connected = false; window.dispatchEvent(new Event("offline")); });
  await render(next);
  await act(async () => { resolve({ ok: true, ...oldScope, rows: [{ ...oldScope, presentation: { fontSizePx: 24 } }] }); await dispatched; });
  expect(latest).toMatchObject({ ready: true, serverAdopted: false, pending: 0 });
  expect(effectivePresentation("phone", latest.rows).fontSizePx).toBe(26);
  expect(parsePreferenceCache(localStorage.getItem(preferenceCacheKey(next))!, next)[0].presentation).toEqual({ fontSizePx: 26 });
  expect(parsePreferenceCache(localStorage.getItem(preferenceCacheKey(oldScope))!, oldScope).find(row => row.ebookId === oldScope.ebookId)?.presentation)
    .toEqual({ fontSizePx: 24 });
});
it("malformed local data falls back safely and leaves a visible recovery warning", async () => {
  localStorage.setItem(preferenceCacheKey(scope), JSON.stringify({ version: 1, scope, rows: [{ ...scope, presentation: { fontSizePx: 999 } }] }));
  sessionStorage.setItem(draftKey(scope), "x".repeat(65537));
  await render();
  expect(latest).toMatchObject({ ready: true, serverAdopted: false, pending: 0 });
  expect(latest.recoveryError).not.toBeNull();
  expect(effectivePresentation("desktop", latest.rows).fontSizePx).toBe(20);
  expect(actions.adopt).not.toHaveBeenCalled(); expect(actions.update).not.toHaveBeenCalled();
});

function seedDurableLocalSettings() {
  localStorage.setItem(preferenceCacheKey(scope), serializePreferenceCache(scope,
    [{ deviceClass: scope.deviceClass, ebookId: null, presentation: { fontSizePx: 28 } }]));
  localStorage.setItem(preferenceDraftKey(scope), JSON.stringify({ version: 1,
    owner: "11111111-1111-4111-8111-111111111111", draft: { version: 1, scope, jobs: [
      { kind: "update", input: { deviceClass: scope.deviceClass, ebookId: null, presentation: { lineHeight: 1.8 } } },
    ] } }));
}
it("a downloaded reader opens with onLine true and rejected origin adoption, preserving durable intent", async () => {
  connected = true; seedDurableLocalSettings();
  actions.adopt.mockRejectedValueOnce(new Error("Origin unreachable."));
  await render(scope, true);
  expect(host.textContent).toBe("ready");
  expect(latest).toMatchObject({ ready: true, serverAdopted: false, pending: 1, recoverySaved: true, error: "Origin unreachable." });
  expect(effectivePresentation("desktop", latest.rows)).toMatchObject({ fontSizePx: 28, lineHeight: 1.8 });
  expect(actions.update).not.toHaveBeenCalled(); expect(actions.reset).not.toHaveBeenCalled();
  expect(document.cookie).toContain(`${READER_SETTINGS_KEY}=kept`);
  await act(async () => { latest.update({ ...scope, presentation: { fontSizePx: 24 } }); latest.reset(scope); });
  expect(latest).toMatchObject({ ready: true, serverAdopted: false, pending: 3, recoverySaved: true });
  expect(JSON.parse(localStorage.getItem(preferenceDraftKey(scope))!).draft.jobs).toHaveLength(3);
  expect(parsePreferenceCache(localStorage.getItem(preferenceCacheKey(scope))!, scope)[0].presentation).toHaveProperty("fontSizePx", 28);
  await act(async () => { await latest.flush(); });
  expect(actions.adopt).toHaveBeenCalledTimes(2); expect(actions.update).toHaveBeenCalledTimes(2); expect(actions.reset).toHaveBeenCalledTimes(1);
  expect(actions.adopt.mock.invocationCallOrder[1]).toBeLessThan(actions.update.mock.invocationCallOrder[0]);
  expect(actions.update.mock.invocationCallOrder[1]).toBeLessThan(actions.reset.mock.invocationCallOrder[0]);
  expect(latest).toMatchObject({ ready: true, serverAdopted: true, pending: 0, error: null });
  expect(JSON.parse(localStorage.getItem(preferenceDraftKey(scope))!).draft.jobs).toEqual([]);
  expect(document.cookie).not.toContain(`${READER_SETTINGS_KEY}=kept`);
});
it("onLine true and indefinitely pending adoption cannot hold local admission or durable edits", async () => {
  connected = true; seedDurableLocalSettings();
  let resolve!: (value: PreferenceReply) => void;
  actions.adopt.mockImplementationOnce(() => new Promise<PreferenceReply>(done => { resolve = done; }));
  await render(scope, true);
  expect(host.textContent).toBe("ready");
  expect(latest).toMatchObject({ ready: true, serverAdopted: false, pending: 1, saving: true, recoverySaved: true });
  expect(effectivePresentation("desktop", latest.rows)).toMatchObject({ fontSizePx: 28, lineHeight: 1.8 });
  await act(async () => { latest.update({ ...scope, presentation: { fontSizePx: 24 } }); });
  expect(latest).toMatchObject({ ready: true, serverAdopted: false, pending: 2, recoverySaved: true });
  expect(JSON.parse(localStorage.getItem(preferenceDraftKey(scope))!).draft.jobs[1].input.presentation).toEqual({ fontSizePx: 24 });
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(host.textContent).toBe("ready"); expect(actions.adopt).toHaveBeenCalledTimes(1);
  expect(actions.update).not.toHaveBeenCalled(); expect(actions.reset).not.toHaveBeenCalled();
  expect(document.cookie).toContain(`${READER_SETTINGS_KEY}=kept`);
  // Only a real matching reply makes replay eligible when the origin becomes reachable.
  await act(async () => { resolve(reply(scope)); await latest.flush(); });
  expect(latest).toMatchObject({ ready: true, serverAdopted: true, pending: 0 });
  expect(actions.update).toHaveBeenCalledTimes(2);
  expect(actions.adopt.mock.invocationCallOrder[0]).toBeLessThan(actions.update.mock.invocationCallOrder[0]);
  expect(document.cookie).not.toContain(`${READER_SETTINGS_KEY}=kept`);
});
it("downloaded admission with no cache uses safe defaults even while online adoption hangs", async () => {
  connected = true;
  actions.adopt.mockImplementationOnce(() => new Promise<PreferenceReply>(() => {}));
  await render();
  expect(latest).toMatchObject({ ready: true, serverAdopted: false, pending: 0 });
  expect(effectivePresentation("desktop", latest.rows)).toMatchObject({ fontSizePx: 20, theme: "durtal-dark" });
  expect(document.cookie).toContain(`${READER_SETTINGS_KEY}=kept`);
  expect(actions.update).not.toHaveBeenCalled(); expect(actions.reset).not.toHaveBeenCalled();
});
it("disconnect before an ordinary online reader's first adoption selects validated cached rows", async () => {
  connected = true; seedDurableLocalSettings();
  let resolve!: (value: PreferenceReply) => void;
  actions.adopt.mockImplementationOnce(() => new Promise<PreferenceReply>(done => { resolve = done; }));
  await render(scope, false, false);
  expect(latest).toMatchObject({ ready: false, serverAdopted: false });
  await act(async () => { connected = false; window.dispatchEvent(new Event("offline")); });
  expect(latest).toMatchObject({ ready: true, serverAdopted: false, pending: 1, recoverySaved: true });
  expect(effectivePresentation("desktop", latest.rows)).toMatchObject({ fontSizePx: 28, lineHeight: 1.8 });
  const savedCache = localStorage.getItem(preferenceCacheKey(scope));
  await act(async () => { resolve(reply(scope)); });
  expect(effectivePresentation("desktop", latest.rows)).toMatchObject({ fontSizePx: 28, lineHeight: 1.8 });
  expect(localStorage.getItem(preferenceCacheKey(scope))).toBe(savedCache);
  expect(document.cookie).toContain(`${READER_SETTINGS_KEY}=kept`);
  expect(actions.update).not.toHaveBeenCalled();
});
