// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@/components/ui/dialog";
import { acquireSurface, type SurfaceLease } from "@/lib/ui/surface-state";

// Focus survey, cause 5: after a page change, or after a layer the palette
// opened, the focus fell to the page body.

const route = vi.hoisted(() => ({ path: "/library/a" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path }));

import { NavigationFocus } from "@/components/shared/navigation-focus";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  route.path = "/library/a";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const frames = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

/** A page: its heading and an Actions button, keyed by path so each is new */
function page(path: string, extra?: ReactNode) {
  return h(
    "div",
    null,
    h("a", { href: "/settings" }, "Settings"),
    h(NavigationFocus),
    h(
      "main",
      { key: path },
      h("h1", null, path),
      h("button", { type: "button", "aria-label": "Export" }),
      h("button", { type: "button", "aria-label": "Actions" }),
      extra,
    ),
  );
}

describe("focus after a page change", () => {
  it("leaves the focus alone when the page first loads", async () => {
    act(() => root.render(page("/library/a")));
    await frames();
    expect(document.activeElement).toBe(document.body);
  });

  it("goes to the same named control on the new page (a renamed book's Actions)", async () => {
    act(() => root.render(page("/library/a")));
    const actions = host.querySelector<HTMLElement>('[aria-label="Actions"]')!;
    actions.focus();
    route.path = "/library/b";
    act(() => root.render(page("/library/b")));
    await frames();
    const now = host.querySelector('[aria-label="Actions"]');
    expect(now).not.toBe(actions);
    expect(document.activeElement).toBe(now);
  });

  it("else to the new page's heading (a palette pick, a deleted collection)", async () => {
    act(() => root.render(page("/collections/x", h("button", { type: "button" }, "Delete collection"))));
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Delete collection")!.focus();
    route.path = "/collections";
    act(() => root.render(page("/collections")));
    await frames();
    const heading = host.querySelector("h1")!;
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("but keeps a focus that survived the change (a sidebar link)", async () => {
    act(() => root.render(page("/library/a")));
    const link = host.querySelector<HTMLElement>('a[href="/settings"]')!;
    link.focus();
    route.path = "/settings";
    act(() => root.render(page("/settings")));
    await frames();
    expect(document.activeElement).toBe(link);
  });
});

describe("a layer the palette opened as it closed", () => {
  it("gives the focus back to where it was before the palette (Keyboard shortcuts, then Escape)", async () => {
    let lease: SurfaceLease | null = null;
    let pick = () => {};
    let closeHelp = () => {};
    function Probe() {
      const [palette, setPalette] = useState(false);
      const [help, setHelp] = useState(false);
      pick = () => {
        setPalette(false);
        setHelp(true);
      };
      closeHelp = () => setHelp(false);
      return h(
        "div",
        null,
        h("button", { type: "button", onClick: () => { lease = acquireSurface(() => setPalette(false)); setPalette(true); } }, "Sort"),
        palette && h("input", { "aria-label": "Search", autoFocus: true }),
        h(Dialog, { open: help, onClose: () => setHelp(false), title: "Keyboard shortcuts", children: h("button", { type: "button" }, "Done") }),
      );
    }
    act(() => root.render(h(Probe)));
    const opener = [...host.querySelectorAll("button")].find((b) => b.textContent === "Sort")!;
    opener.focus();
    act(() => opener.click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Search");
    // The pick closes the palette, and React renders the help after the
    // event's own microtasks, as it does for a real pick
    await act(async () => {
      lease?.release();
      lease = null;
      await Promise.resolve();
      pick();
    });
    await frames();
    act(() => closeHelp());
    await frames();
    expect(document.activeElement).toBe(opener);
  });
});
