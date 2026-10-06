// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NoteEdit } from "@/lib/actions/reading-notes";

// A long quote group opens at its first ten notes (SLN-510)

vi.mock("@/components/reading/reading-provider", () => ({ useReading: () => ({ open: vi.fn(), openRow: null }) }));
vi.mock("@/components/reading/note-controls", () => ({ NoteControls: () => null }));
vi.mock("@/components/reading/note-item", () => ({
  NoteItemView: ({ note }: { note: NoteEdit }) => createElement("p", { "data-note": note.id }, note.body),
}));

import { LONG_GROUP, NotesSection, OPEN_AT, noteAnchor } from "@/components/reading/notes-section";

const scrolled: string[] = [];
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = function () {
    scrolled.push(this.id);
  };
});

let root: Root;
let host: HTMLElement;
beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await address("");
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));
/** The address, before anything is drawn: happy-dom queues a hashchange even for replaceState, which a browser does not */
async function address(hash: string) {
  history.replaceState(null, "", `/library/book${hash}`);
  await settle();
  scrolled.length = 0;
}
/** The notes brought into view; one note may be asked more than once */
const wentTo = () => [...new Set(scrolled)];
const note = (i: number, editionId: string | null = null): NoteEdit => ({
  id: `n${i}`,
  workId: "w",
  kind: "quote",
  body: `Quote ${i}`,
  commentHtml: null,
  page: i,
  endPage: null,
  pageRoman: false,
  chapter: null,
  percent: null,
  isFavourite: false,
  readingId: null,
  readingOrdinal: null,
  editionId,
});
const notes = (n: number, editionId: string | null = null) => Array.from({ length: n }, (_, i) => note(i + 1, editionId));
const shown = () => [...host.querySelectorAll("[data-note]")].map((el) => el.getAttribute("data-note"));
const showAll = () => host.querySelector<HTMLButtonElement>("[data-notes-show-all]");

function draw(list: NoteEdit[], editionOrder: string[] = []) {
  const editions = Object.fromEntries(editionOrder.map((id) => [id, { id, label: `Edition ${id}` }]));
  act(() =>
    root.render(
      createElement(NotesSection, {
        notes: list,
        book: { title: "Book", authors: [] } as never,
        editions: editions as never,
        editionOrder,
      }),
    ),
  );
}

describe("long quote groups", () => {
  it("shows a group shorter than LONG_GROUP whole", () => {
    draw(notes(LONG_GROUP - 1));
    expect(shown()).toHaveLength(LONG_GROUP - 1);
    expect(showAll()).toBeNull();
  });

  it("opens a long group at OPEN_AT notes, and Show all draws the rest in place", async () => {
    draw(notes(200));
    expect(shown()).toHaveLength(OPEN_AT);
    expect(showAll()?.textContent).toBe("Show all 200");
    act(() => showAll()!.click());
    await settle();
    expect(shown()).toHaveLength(200);
    expect(showAll()).toBeNull();
    // The focus goes to the first new note, where the button was, and nothing scrolls
    expect(document.activeElement?.id).toBe(noteAnchor(`n${OPEN_AT + 1}`));
    expect(scrolled).toEqual([]);
  });

  it("gives each group its own Show all", () => {
    draw([...notes(3, "a"), ...notes(20, "b").map((n) => ({ ...n, id: `b${n.id}` }))], ["a", "b"]);
    expect(host.querySelectorAll("[data-notes-show-all]")).toHaveLength(1);
    expect(host.querySelector('[data-notes-group="a"] [data-notes-show-all]')).toBeNull();
    expect(host.querySelector('[data-notes-group="b"] [data-notes-show-all]')?.textContent).toBe("Show all 20");
  });

  it("opens the group of a note named in the address, and goes to it", async () => {
    await address("#note-n150");
    draw(notes(200));
    await settle();
    expect(shown()).toHaveLength(200);
    expect(wentTo()).toEqual([noteAnchor("n150")]);
  });

  it("goes to a shown note without opening its group", async () => {
    await address("#note-n3");
    draw(notes(200));
    await settle();
    expect(shown()).toHaveLength(OPEN_AT);
    expect(wentTo()).toEqual([noteAnchor("n3")]);
  });

  it("holds the note in view while the passages above reflow, until the reader scrolls", async () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {
          observers.length = 0;
        }
      },
    );
    await address("#note-n150");
    draw(notes(200));
    await settle();
    expect(scrolled).toEqual([noteAnchor("n150")]);
    act(() => observers.forEach((reflow) => reflow()));
    expect(scrolled).toEqual([noteAnchor("n150"), noteAnchor("n150")]);
    window.dispatchEvent(new WheelEvent("wheel"));
    expect(observers).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("opens the group when the address changes to a hidden note", async () => {
    draw(notes(200));
    await settle();
    expect(shown()).toHaveLength(OPEN_AT);
    history.replaceState(null, "", "/library/book#note-n42");
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await settle();
    expect(shown()).toHaveLength(200);
    expect(wentTo()).toEqual([noteAnchor("n42")]);
  });
});
