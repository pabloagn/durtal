// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DeferredFeature, PENDING_DELAY_MS, preloadFeature } from "@/components/ui/feature-renderer";
import { hasOpenSurface } from "@/lib/ui/surface-state";

// SLN-1464: a reading dialog opened "Loading reading action…" first, then the
// dialog: two modals and two focus moves for one tap

let root: Root, host: HTMLElement, opener: HTMLButtonElement;
const opened: string[] = [];
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const loading = () => host.querySelector('dialog[aria-label="Loading reading action"][open]');

/** The dialog a feature renders: a native modal that takes the focus */
function Feature({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current!.showModal();
    ref.current!.querySelector("input")!.focus();
  }, []);
  return h("dialog", { ref, "aria-label": "Log progress", onCancel: onClose }, h("input", { "aria-label": "Page" }));
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () {
    opened.push(this.getAttribute("aria-label") ?? "");
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => {
  opened.length = 0;
  opener = document.createElement("button"); document.body.append(opener); opener.focus();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  expect(hasOpenSurface()).toBe(false);
  host.remove(); opener.remove();
});

function open(load: () => Promise<typeof Feature>) {
  const close = vi.fn(() => act(() => root.render(null)));
  act(() => root.render(h(DeferredFeature<{ onClose(): void }>, { load, rendererProps: { onClose: close }, close })));
  return close;
}

describe("a deferred dialog", () => {
  it("opens first time, with no loading modal, once preloaded", async () => {
    const load = vi.fn(async () => Feature);
    await act(async () => { await preloadFeature(load); });
    open(load);
    expect(opened).toEqual(["Log progress"]);
    expect(host.querySelector("dialog[aria-label='Loading reading action']")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Page");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("opens with no loading modal when it loads within the delay", async () => {
    let finish!: () => void;
    const load = vi.fn(() => new Promise<typeof Feature>((resolve) => { finish = () => resolve(Feature); }));
    open(load);
    await wait(PENDING_DELAY_MS / 2);
    expect(loading()).toBeNull();
    expect(host.querySelector("dialog[open]")).toBeNull();
    expect(document.activeElement).toBe(opener);
    await act(async () => { finish(); });
    await wait(10);
    expect(opened).toEqual(["Log progress"]);
  });

  it("says it is loading only once it is slow, and Escape cancels before that", async () => {
    const load = vi.fn(() => new Promise<typeof Feature>(() => {}));
    open(load);
    await wait(10);
    expect(loading()).toBeNull();
    expect(hasOpenSurface()).toBe(true);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(hasOpenSurface()).toBe(false);
    expect(document.activeElement).toBe(opener);

    open(vi.fn(() => new Promise<typeof Feature>(() => {})));
    await wait(PENDING_DELAY_MS + 20);
    expect(loading()).not.toBeNull();
    expect(opened).toEqual(["Loading reading action"]);
  });

  it("shares a preload still under way with the open, and loads again after a failed one", async () => {
    let finish!: () => void;
    const shared = vi.fn(() => new Promise<typeof Feature>((resolve) => { finish = () => resolve(Feature); }));
    void preloadFeature(shared);
    open(shared);
    await wait(0);
    await act(async () => { finish(); });
    await wait(10);
    expect(shared).toHaveBeenCalledTimes(1);
    expect(opened).toEqual(["Log progress"]);
    act(() => root.render(null));

    opened.length = 0;
    const flaky = vi.fn().mockRejectedValueOnce(new Error("chunk failed")).mockResolvedValue(Feature);
    await act(async () => { await preloadFeature(flaky); });
    open(flaky);
    await wait(10);
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(opened).toEqual(["Log progress"]);
  });
});
