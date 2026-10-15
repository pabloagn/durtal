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

function render(annotations: ReaderAnnotation[], onPick = vi.fn(async () => true)) {
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
});
