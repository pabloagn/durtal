// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReaderAnnotation } from "@/lib/reader/annotations";

// The reader's Highlights and notes panel (SLN-726), outside its side panel
vi.mock("next/font/google", () => ({ EB_Garamond: () => ({ variable: "font-prose" }) }));
vi.mock("@/components/reader/side-panel", () => ({
  ReaderSidePanel: ({ children }: { children: ReactNode }) => createElement("div", { "data-panel": "" }, children),
}));

import { AnnotationsPanel } from "@/components/reader/annotations-panel";

const mark = (id: string, patch: Partial<ReaderAnnotation> = {}): ReaderAnnotation => ({
  id,
  ebookId: "book",
  fileId: "file",
  kind: "highlight",
  style: "highlight",
  color: "ochre",
  locator: { href: "c1.xhtml", progression: 0.1, sectionIndex: 0, text: { highlight: "a passage" } } as ReaderAnnotation["locator"],
  progression: 0.1,
  chapter: "Chapter 1",
  text: "A passage worth keeping.",
  note: null,
  anchorState: "exact",
  deviceId: null,
  clientUpdatedAt: "2026-10-15T08:00:00.000Z",
  createdAt: "2026-10-15T08:00:00.000Z",
  updatedAt: "2026-10-15T08:00:00.000Z",
  deletedAt: null,
  ...patch,
});

let root: Root | null = null;
let host: HTMLElement;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

function render(annotations: ReaderAnnotation[], onPick = vi.fn(async () => true), imagesOnly = false) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(AnnotationsPanel, {
        open: true,
        onClose: () => {},
        book: { id: "book", title: "A Book", authors: [] },
        annotations,
        onPick,
        onNote: () => {},
        onEdit: () => {},
        onDelete: () => {},
        imagesOnly,
      }),
    ),
  );
  return onPick;
}
const buttons = () => [...host.querySelectorAll("button")].map((button) => button.textContent?.trim() || button.getAttribute("aria-label"));

describe("the Highlights and notes panel", () => {
  it("says how to make a first highlight, with nothing to filter or export, when the book has no marks", () => {
    render([]);
    expect(host.textContent).toContain("No highlights yet. Select text in the book to highlight it.");
    expect(host.textContent).not.toContain("match");
    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(buttons()).not.toContain("Export");
    expect(host.querySelector('a[href="/ebooks/highlights"]')).not.toBeNull();
  });

  it("goes to a mark from its passage, keeps the rest in one menu, and writes the day as the highlights page does", async () => {
    const onPick = render([mark("a")]);
    const go = host.querySelector<HTMLButtonElement>("[data-annotation-go]")!;
    expect(go.textContent).toContain("A passage worth keeping.");
    expect(go.textContent).toContain("2026-10-15");
    expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.placeholder).toBe("Find in 1 highlight");
    // The row's only other control is its menu
    expect(buttons().filter((label) => !["Highlights", "Notes", "Bookmarks", "Any colour", "Book order", "Export"].includes(label ?? ""))).toEqual([
      go.textContent?.trim(),
      "Highlight actions",
    ]);
    await act(async () => go.click());
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("offers no passage to go to for a mark that could not be placed", () => {
    render([mark("a", { anchorState: "orphaned" })]);
    expect(host.querySelector("[data-annotation-go]")).toBeNull();
    expect(host.textContent).toContain("Could not be placed");
  });

  describe("SLN-682", () => {
    const at = (id: string, cfi: string, progression: number) =>
      mark(id, { locator: { href: "c1.xhtml", progression, sectionIndex: 0, cfi } as ReaderAnnotation["locator"], text: `Passage ${id}` });
    const passages = () => [...host.querySelectorAll('[data-annotation-go] [id$="-text"]')].map((el) => el.textContent);

    it("lists marks in the order they come in the book, by position, not by the page they were made on", () => {
      // p. 32 was made on a page whose progression is lower than p. 31's
      render([at("p32", "epubcfi(/6/4!/4/64/1:0)", 0.2), at("p31", "epubcfi(/6/4!/4/62/1:0)", 0.3)]);
      expect(passages()).toEqual(["Passage p31", "Passage p32"]);
    });

    // happy-dom has no layout: a clamped element reports its overflow through these
    const layout = (cut: (el: HTMLElement) => boolean) => {
      const own = (name: "scrollHeight" | "clientHeight", value: (el: HTMLElement) => number) =>
        vi.spyOn(HTMLElement.prototype, name, "get").mockImplementation(function (this: HTMLElement) { return value(this); });
      own("clientHeight", () => 100);
      own("scrollHeight", (el) => (cut(el) ? 400 : 100));
    };
    const menu = async () => {
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Highlight actions"]')!.click());
      return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => item.textContent);
    };

    it("offers the whole text only when the clamp cuts some (SLN-682)", async () => {
      layout(() => false);
      render([mark("a", { text: "word ".repeat(40), note: "word ".repeat(80) })]);
      const items = await menu();
      expect(items).toContain("Delete highlight and note");
      expect(items).not.toContain("Show the full passage");
      expect(items).not.toContain("Show the full note");
      vi.restoreAllMocks();
    });

    it("offers a short verse cut by its line breaks whole", async () => {
      layout((el) => el.id.endsWith("-text") && el.className.includes("line-clamp-3"));
      render([mark("a", { text: "Sweet are the uses\nof adversity,\nwhich, like the toad,\nugly and venomous" })]);
      expect(await menu()).toContain("Show the full passage");
      vi.restoreAllMocks();
    });

    it("cuts a long note at six lines and offers it whole from the row's menu", async () => {
      layout((el) => el.className.includes("line-clamp-6"));
      render([mark("a", { note: "word ".repeat(400) })]);
      const note = () => host.querySelector('[id$="-note"]')!;
      expect(note().className).toContain("line-clamp-6");
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Highlight actions"]')!.click());
      const whole = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "Show the full note");
      expect(whole).toBeDefined();
      await act(async () => whole!.click());
      expect(note().className).not.toContain("line-clamp-6");
      expect(await menu()).toContain("Show less");
      vi.restoreAllMocks();
    });

    it("labels a quote", () => {
      render([mark("q", { style: "quote", color: null })]);
      expect(host.querySelector('[id$="-place"]')?.textContent).toMatch(/^Quote · /);
    });

    it("keeps a comic to its bookmarks and says why", () => {
      render([mark("a"), mark("b", { kind: "bookmark", color: null, text: null })], vi.fn(async () => true), true);
      expect(host.textContent).toContain("cannot be highlighted. Bookmarks still work.");
      expect(buttons()).not.toContain("Highlights");
      expect(host.querySelectorAll("[data-annotation-go]")).toHaveLength(1);
    });
  });
});
