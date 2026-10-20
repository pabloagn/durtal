// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  EditionForm,
  EMPTY_EDITION,
  editionPayload,
  type EditionFormValues,
} from "@/components/books/edition-form";

// SLN-1131: an edition's contributors can be put in order and given another
// role, each control names its person, and the name search takes the
// arrows, Enter and Escape. Remote searches are replaced; the form is real.
const search = vi.hoisted(() => ({ results: [] as { id: string; name: string }[] }));
vi.mock("@/hooks/use-author-search", () => ({
  useAuthorSearch: (query: string) => ({ results: query ? search.results : [], isSearching: false }),
}));
vi.mock("@/hooks/use-publisher-search", () => ({ usePublisherSearch: () => ({ results: [], isSearching: false }) }));
vi.mock("@/lib/actions/publishers", () => ({ createPublisherFromName: vi.fn() }));

let host: HTMLDivElement;
let root: Root;
let saved: EditionFormValues | null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  saved = null;
  search.results = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const BALDICK = { authorId: "c1", authorName: "Robert Baldick", role: "translator" };
const MAULDON = { authorId: "c2", authorName: "Margaret Mauldon", role: "translator" };

function render(contributors: EditionFormValues["contributors"]) {
  act(() =>
    root.render(
      createElement(EditionForm, {
        initialValues: { ...EMPTY_EDITION, title: "Synthetic edition", language: "en", contributors },
        availableGenres: [],
        availableTags: [],
        onSubmit: async (values: EditionFormValues) => {
          saved = values;
        },
        submitLabel: "Save changes",
        isPending: false,
      }),
    ),
  );
}
const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const click = (el: HTMLElement) => act(() => el.click());
const section = (name: string) =>
  [...host.querySelectorAll<HTMLElement>("section")].find(
    (el) => el.querySelector(":scope > h3 > button")?.textContent?.trim() === name,
  )!;
async function save() {
  await act(async () => {
    host.querySelector("form")!.requestSubmit();
    await Promise.resolve();
  });
}
function key(el: Element, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}
function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("opens Contributors when the edition has some, and not when it has none", () => {
  render([BALDICK]);
  expect(section("Contributors").querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  act(() => root.unmount());
  root = createRoot(host);
  render([]);
  expect(section("Contributors").querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
});

it("moves a contributor and changes a role, and saves both", async () => {
  render([BALDICK, MAULDON]);
  expect(button("Move Robert Baldick up").disabled).toBe(true);
  click(button("Move Margaret Mauldon up"));
  // The role menu of the first row, now Margaret Mauldon's
  click(host.querySelector<HTMLElement>('[aria-label="Role of Margaret Mauldon"]')!);
  click([...host.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.includes("Editor"))!);
  await save();
  expect(editionPayload(saved!, "en").contributorIds).toEqual([
    { authorId: "c2", role: "editor" },
    { authorId: "c1", role: "translator" },
  ]);
});

it("names each Remove after its person, with a 44px press area on touch", () => {
  render([BALDICK, MAULDON]);
  const removes = [...host.querySelectorAll("button[aria-label^='Remove ']")];
  expect(removes.map((b) => b.getAttribute("aria-label"))).toEqual(["Remove Robert Baldick", "Remove Margaret Mauldon"]);
  expect(removes[0]!.className).toContain("pointer-coarse:size-11");
});

it("adds a typed name on Enter, though an author's name starts the same", () => {
  search.results = [{ id: "c5", name: "John Smithson" }];
  render([]);
  const input = host.querySelector<HTMLInputElement>("#ed-contributor-name")!;
  type(input, "John Smith");
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect(key(input, "Enter").defaultPrevented).toBe(true);
  expect(input.value).toBe("");
  expect(host.textContent).toContain("John Smith");
  expect(host.querySelector('[aria-label="Remove John Smith"]')).not.toBeNull();
});

it("picks a contributor's name with the keyboard alone, and Escape only closes the list", async () => {
  search.results = [
    { id: "c3", name: "Brendan King" },
    { id: "c4", name: "Brian Stableford" },
  ];
  render([]);
  const input = host.querySelector<HTMLInputElement>("#ed-contributor-name")!;
  type(input, "Br");
  expect(input.getAttribute("aria-expanded")).toBe("true");
  // Nothing is chosen until the arrows choose it
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  expect(key(input, "ArrowDown").defaultPrevented).toBe(true);
  expect(key(input, "ArrowDown").defaultPrevented).toBe(true);
  const options = [...host.querySelectorAll('[role="listbox"][aria-label="Authors found"] [role="option"]')];
  expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
  expect(key(input, "Enter").defaultPrevented).toBe(true);
  expect(input.value).toBe("Brian Stableford");
  expect(input.getAttribute("aria-expanded")).toBe("false");
  // Enter again adds the picked name
  expect(key(input, "Enter").defaultPrevented).toBe(true);
  await save();
  expect(editionPayload(saved!, "en").contributorIds).toEqual([{ authorId: "c4", role: "translator" }]);

  type(input, "Br");
  expect(key(input, "Escape").defaultPrevented).toBe(true);
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(input.value).toBe("Br");
});
