// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { act, createElement as h, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderSidePanel } from "@/components/reader/side-panel";
import { SearchPanel } from "@/components/reader/search-panel";
import type { ReaderEngine } from "@/lib/reader/engine";

let host: HTMLDivElement;
let root: Root;
let cleanupRoot: Root | undefined;
let origin: HTMLButtonElement;
let globalDialogStyle: HTMLStyleElement;
let viewportWidth: number;
const show = vi.fn();
const showModal = vi.fn();
const close = vi.fn();

function setViewport(width: number) {
  viewportWidth = width;
  vi.stubGlobal("innerWidth", width);
}

beforeEach(() => {
  cleanupRoot = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setViewport(768);
  vi.spyOn(document.documentElement, "clientWidth", "get")
    .mockImplementation(() => viewportWidth - 6);
  // Model the observed WebKit scrollbar boundary: media queries see762 at768,
  // and1018 at1024, while the reader contract uses the outer viewport width.
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("min-width") ? viewportWidth - 6 >= 768 : viewportWidth - 6 <= 1023,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  show.mockClear(); showModal.mockClear(); close.mockClear();
  vi.spyOn(HTMLDialogElement.prototype, "show").mockImplementation(function (this: HTMLDialogElement) {
    show(); this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
    showModal(); this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    close(); this.open = false;
  });
  // Use the actual competing global declaration, rather than a weakened copy.
  const css = readFileSync(resolve(cwd(), "src/styles/globals.css"), "utf8");
  const dialogRule = css.match(/dialog\[open\]\s*\{[^}]+\}/)?.[0];
  if (!dialogRule) throw new Error("Global open-dialog rule missing");
  globalDialogStyle = document.createElement("style");
  globalDialogStyle.textContent = dialogRule;
  document.head.append(globalDialogStyle);
  origin = document.createElement("button");
  origin.textContent = "Open reader drawer";
  document.body.append(origin);
  origin.focus();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cleanupRoot = root;
});

afterEach(async () => {
  try {
    const mountedRoot = cleanupRoot;
    if (mountedRoot) await act(async () => mountedRoot.unmount());
  } finally {
    host?.remove(); origin?.remove(); globalDialogStyle?.remove();
    cleanupRoot = undefined;
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

async function renderPanel(title = "Contents") {
  const onClose = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return h(ReaderSidePanel, {
      open, title,
      onClose: () => { onClose(); setOpen(false); },
      children: h("button", {
        role: "treeitem", "aria-current": "location", tabIndex: 0,
      }, "Current chapter"),
    });
  }
  await act(async () => root.render(h(Harness)));
  return { panel: host.querySelector<HTMLDialogElement>("dialog")!, onClose };
}

describe("shared reader drawer viewport and dialog-cascade regression", () => {
  it.each([
    [390, "100vw", true],
    [767, "100vw", true],
    [768, "360px", true],
    [769, "360px", true],
    [1023, "360px", true],
    [1024, "360px", false],
    [1440, "360px", false],
  ] as const)("uses the reader viewport contract at%d, including scrollbar boundaries", async (width, expectedWidth, modal) => {
    setViewport(width);
    const { panel } = await renderPanel();
    expect(document.documentElement.clientWidth).toBe(width - 6);
    if (width === 768) expect(matchMedia("(min-width:48rem)").matches).toBe(false);
    if (width === 1024) expect(matchMedia("(max-width:1023px)").matches).toBe(true);
    expect(panel.style.width).toBe(expectedWidth);
    expect(panel.getAttribute("aria-modal")).toBe(modal ? "true" : null);
    expect(panel.hasAttribute("data-reader-modal")).toBe(modal);
    expect(modal ? showModal : show).toHaveBeenCalled();
    expect(panel.open).toBe(true);
  });

  it.each(["Contents", "Search in book", "Highlights and notes"])(
    "removes centering and the height cap for%s against the actual global dialog rule", async title => {
      const { panel } = await renderPanel(title);
      // happy-dom does not resolve dvh or layout. Native QA must measure full
      // viewport height; this checks the real competing centering/height cap.
      const computed = getComputedStyle(panel);
      expect(computed.maxHeight).toBe("none");
      expect(computed.marginTop).toBe("0px");
      expect(computed.marginBottom).toBe("0px");
      expect(computed.top).toBe("0px");
      expect(computed.bottom).toBe("0px");
      expect(computed.left).toBe("0px");
      expect(computed.right).toBe("auto");
      expect(panel.classList.contains("glass-bar")).toBe(true);
      expect(panel.classList.contains("overflow-hidden")).toBe(true);
      const body = panel.lastElementChild!;
      expect(body.classList.contains("overflow-y-auto")).toBe(true);
      expect(body.classList.contains("min-h-0")).toBe(true);
      expect(body.contains(panel.querySelector('button[aria-label="Close"]'))).toBe(false);
      const ordinary = document.createElement("dialog");
      ordinary.open = true; host.append(ordinary);
      expect(getComputedStyle(ordinary).maxHeight).toBe(`${(window.innerHeight * 90) / 100}px`);
      expect(getComputedStyle(ordinary).marginTop).toBe("auto");
    },
  );

  it("updates phone/tablet width without reopening, and changes native modality at1024", async () => {
    setViewport(767);
    const { panel } = await renderPanel();
    const current = panel.querySelector<HTMLElement>('[aria-current="location"]')!;
    expect(document.activeElement).toBe(current);
    show.mockClear(); showModal.mockClear(); close.mockClear();
    await act(async () => { setViewport(768); window.dispatchEvent(new Event("resize")); });
    expect(panel.style.width).toBe("360px");
    expect(show).not.toHaveBeenCalled();
    expect(showModal).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(current);
    await act(async () => { setViewport(1024); window.dispatchEvent(new Event("resize")); });
    expect(panel.getAttribute("aria-modal")).toBeNull();
    expect(show).toHaveBeenCalledTimes(1);
    expect(showModal).not.toHaveBeenCalled();
    expect(panel.open).toBe(true);
    expect(document.activeElement).toBe(current);
    await act(async () => { setViewport(767); window.dispatchEvent(new Event("resize")); });
    expect(panel.style.width).toBe("100vw");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(current);
  });

  it.each([768, 1024])("closes on Escape and restores the original focus at%d", async width => {
    setViewport(width);
    const { panel, onClose } = await renderPanel();
    expect(document.activeElement).toBe(panel.querySelector('[aria-current="location"]'));
    await act(async () => { panel.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(origin);
  });

  it("gives focus back to the menu's button when the drawer was opened from its item", async () => {
    const wrapper = document.createElement("div");
    const more = document.createElement("button");
    more.setAttribute("aria-haspopup", "menu");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    item.setAttribute("role", "menuitem");
    menu.append(item);
    wrapper.append(more, menu);
    document.body.append(wrapper);
    item.focus();
    const { panel, onClose } = await renderPanel("Reading settings");
    // The menu closes as the drawer opens
    menu.remove();
    await act(async () => { panel.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(more);
    wrapper.remove();
  });

  it("handles native cancel once and restores focus after dismissal", async () => {
    const { panel, onClose } = await renderPanel();
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => { panel.dispatchEvent(cancel); });
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(origin);
  });

  it("removes the viewport listener when the drawer owner unmounts", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    await renderPanel();
    await act(async () => root.render(null));
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(document.activeElement).toBe(origin);
  });
});

describe("reader drawer modality resize preserves the user's current interaction", () => {
  it.each([false, true])("retains actual Search input focus, query, caret and scroll (StrictMode%s)", async strict => {
    setViewport(1023);
    const onClose = vi.fn();
    const engine = {
      currentLocator: () => null,
      setDecorations: vi.fn(),
    } as unknown as ReaderEngine;
    function SearchHarness() {
      const [open, setOpen] = useState(true);
      return h(SearchPanel, {
        open, engine, language: "en", onOpen: vi.fn(), onJump: vi.fn(async () => true),
        onClose: () => { onClose(); setOpen(false); },
      });
    }
    await act(async () => root.render(strict ? h(StrictMode, null, h(SearchHarness)) : h(SearchHarness)));
    // Let Search's real opening frame focus its input before testing resize.
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    const panel = host.querySelector<HTMLDialogElement>("dialog")!;
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Search in book"]')!;
    expect(document.activeElement).toBe(field);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "winter light");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    field.setSelectionRange(2, 8, "forward");
    const body = panel.lastElementChild as HTMLElement;
    body.scrollTop = 121; body.scrollLeft = 5;
    // Exercise restoration even if native cycling temporarily disturbs selection
    // and scrolling. The parent also fails focus retention without these changes.
    vi.mocked(HTMLDialogElement.prototype.close).mockImplementation(function (this: HTMLDialogElement) {
      close(); this.open = false;
      field.setSelectionRange(0, 0);
      body.scrollTop = 0; body.scrollLeft = 0;
      origin.focus();
    });
    for (const width of [1024, 1440, 1023, 768, 767, 1024]) {
      await act(async () => { setViewport(width); window.dispatchEvent(new Event("resize")); });
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe("winter light");
      expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([2, 8, "forward"]);
      expect([body.scrollTop, body.scrollLeft]).toEqual([121, 5]);
      expect(panel.open).toBe(true);
      expect(panel.getAttribute("aria-modal")).toBe(width < 1024 ? "true" : null);
      expect(onClose).not.toHaveBeenCalled();
    }
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(origin);
  });

  it.each(["input", "textarea"] as const)("retains a%s selection direction and nested scroll through both modality changes", async tag => {
    setViewport(1023);
    await act(async () => root.render(h(ReaderSidePanel, {
      open: true, title: "Editor", onClose: vi.fn(),
      children: h("div", { "data-nested-scroll": true },
        h(tag, { defaultValue: "winter light", "aria-label": "Draft" }),
        h("button", { role: "treeitem", "aria-current": "location" }, "Current"),
      ),
    })));
    const panel = host.querySelector<HTMLDialogElement>("dialog")!;
    const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Draft"]')!;
    const nested = host.querySelector<HTMLElement>("[data-nested-scroll]")!;
    const body = panel.lastElementChild as HTMLElement;
    field.focus(); field.setSelectionRange(2, 8, "backward");
    body.scrollTop = 137; body.scrollLeft = 11;
    nested.scrollTop = 41; nested.scrollLeft = 29;
    vi.mocked(HTMLDialogElement.prototype.close).mockImplementation(function (this: HTMLDialogElement) {
      close(); this.open = false;
      field.setSelectionRange(0, 0);
      body.scrollTop = 0; body.scrollLeft = 0;
      nested.scrollTop = 0; nested.scrollLeft = 0;
      origin.focus();
    });
    const focus = vi.spyOn(field, "focus");
    for (const width of [1024, 1023]) {
      await act(async () => { setViewport(width); window.dispatchEvent(new Event("resize")); });
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe("winter light");
      expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([2, 8, "backward"]);
      expect([body.scrollTop, body.scrollLeft, nested.scrollTop, nested.scrollLeft]).toEqual([137, 11, 41, 29]);
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    }
  });

  it("keeps a user-focused tree item instead of resetting to the current chapter", async () => {
    setViewport(1023);
    await act(async () => root.render(h(ReaderSidePanel, {
      open: true, title: "Contents", onClose: vi.fn(),
      children: h("div", null,
        h("button", { role: "treeitem", "aria-current": "location", "data-current": true }, "Current"),
        h("button", { role: "treeitem", "data-other": true }, "Another chapter"),
      ),
    })));
    const current = host.querySelector<HTMLElement>("[data-current]")!;
    const other = host.querySelector<HTMLElement>("[data-other]")!;
    expect(document.activeElement).toBe(current);
    other.focus();
    for (const width of [1024, 1023]) {
      await act(async () => { setViewport(width); window.dispatchEvent(new Event("resize")); });
      expect(document.activeElement).toBe(other);
    }
  });

  it("falls back to the current item if a saved target detaches during native cycling", async () => {
    setViewport(1023);
    await act(async () => root.render(h(ReaderSidePanel, {
      open: true, title: "Contents", onClose: vi.fn(),
      children: h("div", null,
        h("button", { role: "treeitem", "aria-current": "location", "data-current": true }, "Current"),
        h("input", { "aria-label": "Temporary", defaultValue: "winter light" }),
      ),
    })));
    const current = host.querySelector<HTMLElement>("[data-current]")!;
    const field = host.querySelector<HTMLInputElement>('[aria-label="Temporary"]')!;
    field.focus(); field.setSelectionRange(2, 8);
    const focus = vi.spyOn(field, "focus");
    vi.mocked(HTMLDialogElement.prototype.close).mockImplementation(function (this: HTMLDialogElement) {
      close(); this.open = false; field.remove();
    });
    await act(async () => { setViewport(1024); window.dispatchEvent(new Event("resize")); });
    expect(field.isConnected).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(current);
  });

  it("moves external desktop focus inside when the drawer becomes modal", async () => {
    setViewport(1024);
    const { panel } = await renderPanel();
    origin.focus();
    await act(async () => { setViewport(1023); window.dispatchEvent(new Event("resize")); });
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(panel.querySelector('[aria-current="location"]'));
  });
});
