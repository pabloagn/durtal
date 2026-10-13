// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type AnchorHTMLAttributes, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DuplicateWork } from "@/app/(catalogue)/library/new/wizard-model";

// A plain anchor: the test reads whether the click was held back
vi.mock("next/link", () => ({
  default: ({ ref, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { ref?: Ref<HTMLAnchorElement> }) =>
    createElement("a", { ...props, ref }),
}));
import { DuplicateStep } from "@/app/(catalogue)/library/new/steps/duplicate-step";
import { EditionStep } from "@/app/(catalogue)/library/new/steps/edition-step";
import type { EditionDraft } from "@/app/(catalogue)/library/new/wizard-model";

const emptyEdition = (): EditionDraft => ({
  isbn13: "9780140275360",
  publisher: "",
  publicationYear: "",
  language: "en",
  pageCount: "",
  binding: "",
  coverUrl: "",
});

const work = (patch: Partial<DuplicateWork> = {}): DuplicateWork => ({
  id: "0b8f6c1e-0000-4000-8000-000000000001",
  slug: "the-iliad",
  title: "The Iliad",
  workAuthors: [{ author: { name: "Homer" } }],
  editions: [{ id: "e1", coverS3Key: "covers/e1.jpg", thumbnailS3Key: "covers/e1-thumb.jpg", instances: [{ id: "i1" }] }],
  media: [],
  ...patch,
});

let root: Root;
let host: HTMLElement;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (duplicateWork: DuplicateWork, edited = false) =>
  act(() =>
    root.render(
      createElement(DuplicateStep, {
        duplicateWork,
        edited,
        onAddEdition: () => {},
        onNewWork: () => {},
        cancel: null,
      }),
    ),
  );
const link = (label: string) =>
  [...host.querySelectorAll("a")].find((a) => a.textContent === label) ?? null;
/** Clicks and says whether the link was held back */
function click(element: HTMLElement) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    element.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe("the duplicate panel opens the existing work (SLN-667)", () => {
  it("links to the work's page by slug, else by id", () => {
    render(work());
    expect(link("Open this work")?.getAttribute("href")).toBe("/library/the-iliad");
    render(work({ slug: null }));
    expect(link("Open this work")?.getAttribute("href")).toBe(
      "/library/0b8f6c1e-0000-4000-8000-000000000001",
    );
  });

  it("shows the cover the library card shows: the poster, else the first edition", () => {
    render(work());
    expect(host.querySelector("img")?.getAttribute("src")).toContain("key=covers%2Fe1-thumb.jpg");
    render(work({ media: [{ s3Key: "posters/p.jpg", thumbnailS3Key: "posters/p-thumb.jpg" }] }));
    expect(host.querySelector("img")?.getAttribute("src")).toContain("key=posters%2Fp-thumb.jpg");
    render(work({ editions: [{ id: "e1", coverS3Key: null, thumbnailS3Key: null, instances: [] }] }));
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("No cover");
    expect(host.textContent).toContain("0 copies");
  });

  it("opens at once when nothing was entered", () => {
    render(work());
    expect(click(link("Open this work")!)).toBe(false);
  });

  it("asks before leaving what was entered, and Keep editing returns to the link", () => {
    render(work(), true);
    expect(click(link("Open this work")!)).toBe(true);
    expect(link("Open this work")).toBeNull();
    expect(link("Discard and open")?.getAttribute("href")).toBe("/library/the-iliad");
    const keep = [...host.querySelectorAll("button")].find((b) => b.textContent === "Keep editing")!;
    expect(document.activeElement).toBe(keep);
    act(() => keep.click());
    expect(link("Discard and open")).toBeNull();
    expect(document.activeElement).toBe(link("Open this work"));
  });

  it("Escape keeps editing, and the page's own Esc leaves that key alone", () => {
    render(work(), true);
    click(link("Open this work")!);
    const escape = new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true });
    act(() => {
      link("Discard and open")!.dispatchEvent(escape);
    });
    expect(link("Open this work")).not.toBeNull();
    // Handled here: SLN-631's page guard does not ask on top of this question
    expect(escape.defaultPrevented).toBe(true);
  });
});

describe("the ISBN clash on the edition step opens that book (SLN-667)", () => {
  const renderEdition = (edited: boolean) =>
    act(() =>
      root.render(
        createElement(EditionStep, {
          edition: emptyEdition(),
          onChange: () => {},
          isbnClash: { message: 'Another edition already has this ISBN ("The Iliad"). Open that book to add a copy.', href: "/library/the-iliad" },
          edited,
          wishlist: false,
          checking: false,
          onBack: () => {},
          onLeave: () => {},
          cancel: null,
        }),
      ),
    );

  it("links to the book that holds the ISBN, and asks first when something was entered", () => {
    renderEdition(true);
    expect(host.textContent).toContain('Another edition already has this ISBN ("The Iliad")');
    expect(link("Open that book")?.getAttribute("href")).toBe("/library/the-iliad");
    expect(click(link("Open that book")!)).toBe(true);
    expect(link("Discard and open")?.getAttribute("href")).toBe("/library/the-iliad");
  });

  it("opens at once when nothing was entered", () => {
    renderEdition(false);
    expect(click(link("Open that book")!)).toBe(false);
  });
});
