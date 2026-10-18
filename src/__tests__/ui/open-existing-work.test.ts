// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, Fragment, useRef, type AnchorHTMLAttributes, type ReactNode, type Ref } from "react";
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
import { useEscapeToCancel } from "@/components/shared/escape-to-cancel";

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
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
beforeEach(() => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://localhost/library/new");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * Add book around a step: its unsaved-work guard (SLN-631) asks before a
 * link leaves `unsaved` work behind.
 */
function Page({ unsaved, children }: { unsaved: boolean; children: ReactNode }) {
  const form = useRef<HTMLDivElement>(null);
  const prompt = useEscapeToCancel({ root: form, cancel: () => {}, dirty: unsaved, save: null });
  return createElement(Fragment, null, prompt, createElement("div", { ref: form }, children));
}

/** `edited`: what the step says was entered; `unsaved`: what the page's guard holds */
const render = (duplicateWork: DuplicateWork, edited = false, unsaved = edited) =>
  act(() =>
    root.render(
      createElement(Page, {
        unsaved,
        children: createElement(DuplicateStep, {
          duplicateWork,
          edited,
          onAddEdition: () => {},
          onNewWork: () => {},
          cancel: null,
        }),
      }),
    ),
  );
const asking = () =>
  [...document.querySelectorAll("dialog[open]")].some((d) => d.textContent?.includes("Unsaved changes"));
const answer = (name: string) =>
  [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent?.trim() === name) as HTMLButtonElement;
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
    expect(host.querySelector("[data-decorative]")?.textContent).toBe("T");
    expect(host.textContent).toContain("0 copies");
  });

  it("opens at once when nothing was entered", () => {
    render(work());
    expect(click(link("Open this work")!)).toBe(false);
  });

  it("asks before leaving what was entered: Keep editing stays, Discard opens the work", () => {
    render(work(), true);
    const followed: string[] = [];
    const follow = (event: Event) => {
      if (event.defaultPrevented || !(event.target instanceof HTMLAnchorElement)) return;
      followed.push(event.target.getAttribute("href")!);
      event.preventDefault(); // the test stays on its page
    };
    document.addEventListener("click", follow);
    try {
      expect(click(link("Open this work")!)).toBe(true);
      expect(asking()).toBe(true);
      act(() => answer("Keep editing").click());
      expect(asking()).toBe(false);
      expect(followed).toEqual([]);
      click(link("Open this work")!);
      act(() => answer("Discard").click());
      expect(followed).toEqual(["/library/the-iliad"]);
    } finally {
      document.removeEventListener("click", follow);
    }
  });

  it("Escape on the question keeps editing, and asks nothing more", () => {
    render(work(), true);
    click(link("Open this work")!);
    const escape = new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true });
    act(() => {
      answer("Discard").dispatchEvent(escape);
    });
    expect(asking()).toBe(false);
    expect(link("Open this work")).not.toBeNull();
  });

  it("opens at once when the step counts nothing as entered, whatever the page holds", () => {
    render(work(), false, true);
    expect(click(link("Open this work")!)).toBe(false);
    expect(asking()).toBe(false);
  });
});

describe("the ISBN clash on the edition step opens that book (SLN-667)", () => {
  const renderEdition = (edited: boolean) =>
    act(() =>
      root.render(
        createElement(Page, { unsaved: edited, children: createElement(EditionStep, {
          edition: emptyEdition(),
          onChange: () => {},
          isbnClash: { message: 'Another edition already has this ISBN ("The Iliad"). Open that book to add a copy.', href: "/library/the-iliad" },
          edited,
          wishlist: false,
          checking: false,
          onBack: () => {},
          onLeave: () => {},
          cancel: null,
        }) }),
      ),
    );

  it("links to the book that holds the ISBN, and asks first when something was entered", () => {
    renderEdition(true);
    expect(host.textContent).toContain('Another edition already has this ISBN ("The Iliad")');
    expect(link("Open that book")?.getAttribute("href")).toBe("/library/the-iliad");
    expect(click(link("Open that book")!)).toBe(true);
    expect(asking()).toBe(true);
  });

  it("opens at once when nothing was entered", () => {
    renderEdition(false);
    expect(click(link("Open that book")!)).toBe(false);
  });
});
