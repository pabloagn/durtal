// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useEffect, useRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ReaderBridgeProvider,
  ReaderSlotFill,
  useReaderContext,
  useReaderEvent,
  useReaderShortcut,
} from "@/components/reader/bridge";
import { ReaderBottomBar } from "@/components/reader/reader-bottom-bar";
import { ReaderNotice } from "@/components/reader/reader-notice";
import { createReaderInput } from "@/lib/reader/input";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import { place } from "./fixtures/places";
import { ProbePlugin } from "./fixtures/probe-plugin";
let root: Root, host: HTMLElement, bridge: ReaderBridgeController;
const context = {
  ebookId: "book",
  fileId: "epub",
  format: "epub" as const,
  locator: null,
  percent: null,
  chapter: null,
  selection: null,
};
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const render = (
  plugins: { id: string; node: ReturnType<typeof h> }[],
  notice?: string,
) =>
  act(() =>
    root.render(
      h(ReaderBridgeProvider, {
        context,
        plugins,
        children: (value) => {
          bridge = value;
          return h(
            "main",
            null,
            h(ReaderBottomBar, {
              visible: true,
              chapter: "Chapter I",
              percent: 44,
              bridge,
            }),
            h(ReaderNotice, { bridge }, notice),
            h("div", {
              ref: (element: HTMLDivElement | null) =>
                bridge.mountSlot("selection-actions", element),
            }),
          );
        },
      }),
    ),
  );
const dispatch = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await Promise.resolve();
  });
describe("reader bridge", () => {
  it("keeps one subscription and the latest closure, and only context consumers render", async () => {
    let renders = 0,
      mounts = 0;
    const seen = vi.fn();
    function Plugin({ label }: { label: string }) {
      const count = useRef(0);
      count.current++;
      useReaderEvent("location", () => seen(label));
      const ctx = useReaderContext();
      renders++;
      return h("output", null, ctx.percent);
    }
    function Frame() {
      useEffect(() => {
        mounts++;
      }, []);
      return h("div", { id: "book-frame" });
    }
    render([{ id: "plugin", node: h(Plugin, { label: "old" }) }]);
    const on = vi.spyOn(bridge.bus, "on");
    render([
      { id: "plugin", node: h(Plugin, { label: "new" }) },
      { id: "frame", node: h(Frame) },
    ]);
    const before = renders;
    act(() =>
      bridge.update({
        locator: place().locator,
        percent: 44,
        chapter: "Chapter II",
      }),
    );
    expect(renders).toBe(before + 1);
    expect(mounts).toBe(1);
    expect(on).not.toHaveBeenCalled();
    bridge.bus.location({
      locator: place().locator,
      chapter: "Chapter",
      fileId: "epub",
      kind: "jump",
      atEnd: false,
    });
    await dispatch();
    expect(seen).toHaveBeenLastCalledWith("new");
  });
  it("orders fills by plugin, hides only own status, and prioritises reader notices", () => {
    function Fill({ text }: { text: string }) {
      return h(
        "div",
        null,
        h(ReaderSlotFill, { slot: "toolbar-status" }, text),
        h(ReaderSlotFill, { slot: "top-bar" }, text),
        h(
          ReaderSlotFill,
          { slot: "selection-actions" },
          h("button", null, text),
        ),
      );
    }
    render(
      [
        { id: "first", node: h(Fill, { text: "First" }) },
        { id: "second", node: h(Fill, { text: "Second" }) },
      ],
      "Reader notice",
    );
    expect(host.querySelector("footer")!.textContent).toBe(
      "Chapter IFirstSecond",
    );
    expect(host.querySelector('[role="status"]')!.textContent).toContain(
      "Reader notice",
    );
    expect(host.querySelector<HTMLElement>('[role="status"] div')!.hidden).toBe(
      true,
    );
    render([
      { id: "first", node: h(Fill, { text: "First" }) },
      { id: "second", node: h(Fill, { text: "Second" }) },
    ]);
    expect(host.querySelector<HTMLElement>('[role="status"] div')!.hidden).toBe(
      false,
    );
    expect(
      [...host.querySelectorAll("main > div button")].map((b) => b.textContent),
    ).toEqual(["First", "Second"]);
    render([]);
    expect(host.querySelector("footer")!.textContent).toBe("Chapter I44%");
  });
  it("selection shortcuts arrive from the book document and never while typing", () => {
    const called = vi.fn();
    function Plugin() {
      useReaderShortcut("q", called, { when: "selection" });
      return null;
    }
    render([{ id: "shortcut", node: h(Plugin) }]);
    const doc = document.implementation.createHTMLDocument("book");
    doc.body.innerHTML = "<p>Text</p><input>";
    const input = createReaderInput({
      isBlocked: () => false,
      hasSelection: () => !!bridge.getSnapshot().selection,
      actions: {
        next() {},
        prev() {},
        left() {},
        right() {},
        first() {},
        last() {},
        toggleBars() {},
        contents() {},
        settings() {},
        fullscreen() {},
        escape() {},
      },
    });
    input.attach(doc);
    const press = (target: Element) =>
      act(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key: "q", bubbles: true }),
        );
      });
    press(doc.querySelector("p")!);
    expect(called).not.toHaveBeenCalled();
    act(() =>
      bridge.update({
        selection: {
          text: "Text",
          locator: place().locator,
          percent: 40,
          chapter: "Chapter",
          fileId: "epub",
        },
      }),
    );
    press(doc.querySelector("input")!);
    expect(called).not.toHaveBeenCalled();
    press(doc.querySelector("p")!);
    expect(called).toHaveBeenCalledOnce();
    input.destroy();
  });
  it("isolates a crashing component while the all-event probe and reader remain alive", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Crash(): never {
      throw new Error("bad plugin");
    }
    const report = vi.fn();
    render([
      { id: "bad", node: h(Crash) },
      { id: "probe", node: h(ProbePlugin, { data: { report } }) },
    ]);
    bridge.bus.location({
      locator: place().locator,
      chapter: "Chapter",
      fileId: "epub",
      kind: "jump",
      atEnd: false,
    });
    await dispatch();
    expect(report).toHaveBeenCalledWith(
      "location",
      expect.objectContaining({ kind: "jump" }),
    );
    expect(host.querySelector("footer")).not.toBeNull();
  });
  it("survives Strict Mode cleanup and reactivation", async () => {
    const report = vi.fn();
    act(() =>
      root.render(
        h(
          StrictMode,
          null,
          h(ReaderBridgeProvider, {
            context,
            plugins: [
              { id: "probe", node: h(ProbePlugin, { data: { report } }) },
            ],
            children: (value) => {
              bridge = value;
              return h("main");
            },
          }),
        ),
      ),
    );
    bridge.bus.activity("key");
    await dispatch();
    expect(report).toHaveBeenCalledOnce();
  });
});
