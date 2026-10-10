// @vitest-environment happy-dom
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FixedLayoutControls } from "@/components/reader/fixed-layout-controls";
import type { ReaderEngine } from "@/lib/reader/engine";
const keys = vi.hoisted(() => ({ live: new Map<string, () => void>() }));
vi.mock("@/components/reader/bridge", () => ({ useReaderFeatureShortcut: (key: string, _issue: number, handler: () => void, enabled: boolean) => {
  useEffect(() => { if (!enabled) return; keys.live.set(key,handler); return () => { if (keys.live.get(key) === handler) keys.live.delete(key); }; },[key,handler,enabled]);
} }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? createElement("div",null,children) : null }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(keys.live.size).toBe(0); vi.unstubAllGlobals(); });
it("admits pointer and stale shortcut mutations against fresh readiness, with StrictMode cleanup", async () => {
  let admitted = true;
  const reset = vi.fn(), adjust = vi.fn(), fit = vi.fn();
  const engine = { fixedPages: () => [], fixedZoom: () => null, setFixedZoom: reset, adjustFixedZoom: adjust, on: () => () => {} } as unknown as ReaderEngine;
  const render = async (enabled: boolean) => { await act(async () => root.render(createElement(StrictMode,null,createElement(FixedLayoutControls,{ engine, fit: "page", onFit: fit, onPick: async () => true, onHeldChange: () => {}, enabled, isAdmitted: () => admitted })))); };
  const click = async (label: string) => { const button = [...host.querySelectorAll("button")].find(item => item.getAttribute("aria-label") === label || item.textContent === label)!; await act(async () => button.click()); };
  await render(true); await click("Page controls");
  const staleWidth = keys.live.get("w")!;
  admitted = false; // Live bridge fails before React has removed the old handlers.
  for (const label of ["Zoom in","Zoom out","Reset zoom","Fit page","Fit width"]) await click(label);
  await act(async () => staleWidth());
  expect(reset).not.toHaveBeenCalled(); expect(adjust).not.toHaveBeenCalled(); expect(fit).not.toHaveBeenCalled();
  await render(false);
  for (const label of ["Zoom in","Zoom out","Reset zoom","Fit page","Fit width"]) {
    const button = [...host.querySelectorAll("button")].find(item => item.getAttribute("aria-label") === label || item.textContent === label)!;
    expect(button.disabled).toBe(true);
  }
  expect(keys.live.size).toBe(0);
  admitted = true; await render(true);
  await click("Zoom in"); await click("Zoom out"); await click("Reset zoom"); await click("Fit page"); await click("Fit width");
  expect(adjust.mock.calls).toEqual([[1],[-1]]); expect(reset.mock.calls).toEqual([[null],[null],[null]]); expect(fit.mock.calls).toEqual([["page"],["width"]]);
  await act(async () => keys.live.get("w")!());
  expect(reset).toHaveBeenCalledTimes(4); expect(fit).toHaveBeenCalledTimes(3); expect(keys.live.size).toBe(2);
});
