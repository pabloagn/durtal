// @vitest-environment happy-dom
import { act, createElement as h, Fragment, StrictMode, useEffect, useState } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderBridgeProvider, ReaderSlotFill } from "@/components/reader/bridge";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";

const context = {
  ebookId: "book",
  fileId: "epub",
  format: "epub" as const,
  locator: null,
  percent: null,
  chapter: null,
  selection: null,
};
let host: HTMLDivElement;
let root: Root | null;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = null;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("reader plug-in slots during initial hydration", () => {
  it.each([false, true])(
    "hydrates eager fills before the effect-mounted reader frame (StrictMode: %s)",
    async (strict) => {
      const clicked = vi.fn();
      let bridge!: ReaderBridgeController;
      function Frame({ value }: { value: ReaderBridgeController }) {
        const [mounted, setMounted] = useState(false);
        useEffect(() => setMounted(true), []);
        return h(
          "main",
          null,
          h("p", { "data-server-anchor": "" }, "Opening the book"),
          mounted && h("div", {
            "data-tracking-slot": "",
            ref: (element: HTMLDivElement | null) =>
              value.mountSlot("toolbar-status", element),
          }),
          mounted && h("div", {
            "data-selection-slot": "",
            ref: (element: HTMLDivElement | null) =>
              value.mountSlot("selection-actions", element),
          }),
        );
      }
      function TrackingFill() {
        return h(
          Fragment,
          null,
          h(ReaderSlotFill, { slot: "toolbar-status" },
            h("button", { type: "button", onClick: clicked }, "Track this book")),
          h(ReaderSlotFill, { slot: "selection-actions" },
            h("button", { type: "button" }, "Save quote")),
        );
      }
      const reader = h(ReaderBridgeProvider, {
        context,
        plugins: [{ id: "tracking", node: h(TrackingFill) }],
        children: (value) => {
          bridge = value;
          return h(Frame, { value });
        },
      });
      const tree = strict ? h(StrictMode, null, reader) : reader;

      // Reproduce the real server branch; no DOM and no effects run there.
      const browserDocument = document;
      let html: string;
      vi.stubGlobal("document", undefined);
      try {
        html = renderToString(tree);
      } finally {
        vi.stubGlobal("document", browserDocument);
      }
      expect(html).toContain("Opening the book");
      expect(html).not.toContain("<button");
      host.innerHTML = html;
      const serverAnchor = host.querySelector("[data-server-anchor]");

      // Recoverable mismatch must stay empty, not merely regenerate into a
      // functioning UI. Retaining the server node proves hydration preserved it.
      const recovered: unknown[] = [];
      await act(async () => {
        root = hydrateRoot(host, tree, {
          onRecoverableError: (error) => recovered.push(error),
        });
      });
      expect(recovered).toEqual([]);
      expect(host.querySelector("[data-server-anchor]")).toBe(serverAnchor);
      const tracking = host.querySelector("[data-tracking-slot]")!;
      const selection = host.querySelector("[data-selection-slot]")!;
      expect(tracking.querySelectorAll("button")).toHaveLength(1);
      expect(selection.querySelectorAll("button")).toHaveLength(1);
      expect(tracking.textContent).toBe("Track this book");
      expect(selection.textContent).toBe("Save quote");
      expect(bridge.getSlots()["toolbar-status"]).toBe(true);
      expect(bridge.getSlots()["selection-actions"]).toBe(true);
      await act(async () => {
        tracking.querySelector<HTMLButtonElement>("button")!.click();
      });
      expect(clicked).toHaveBeenCalledOnce();

      const fill = tracking.firstElementChild!;
      await act(async () => root!.unmount());
      root = null;
      expect(fill.isConnected).toBe(false);
      expect(bridge.getSlots()["toolbar-status"]).toBe(false);
      expect(bridge.getSlots()["selection-actions"]).toBe(false);
    },
  );
});
