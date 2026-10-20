// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "fs";
import path from "path";
import {
  EMPTY_WORK_FORM,
  WorkForm,
  workPayload,
  type WorkFormValues,
} from "@/components/books/work-form";
import { moveRow } from "@/components/shared/credit-row-controls";

// SLN-1131: a book's authors can be put in order and each control names its
// person; the name search takes the arrows, Enter and Escape. Remote
// searches and toasts are replaced; the form itself is real.
const search = vi.hoisted(() => ({ results: [] as { id: string; name: string }[], searching: false }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@/hooks/use-author-search", () => ({
  useAuthorSearch: (query: string) => ({
    results: query ? search.results : [],
    isSearching: !!query && search.searching,
  }),
}));
vi.mock("@/lib/notifications/toast", () => ({ toast }));
vi.mock("@/lib/actions/catalogue-client", () => ({ findOrCreateAuthor: vi.fn() }));

let host: HTMLDivElement;
let root: Root;
let latest: WorkFormValues;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  toast.error.mockClear();
  search.results = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Form({ authors }: { authors: WorkFormValues["authors"] }) {
  const [values, setValues] = useState<WorkFormValues>({ ...EMPTY_WORK_FORM, title: "Synthetic book", authors });
  latest = values;
  return createElement(WorkForm, {
    idPrefix: "work",
    values,
    onChange: setValues,
    workTypes: [],
    series: [],
    recommenders: [],
    seriesKey: "",
    pending: false,
    onCancel: () => {},
    onSubmit: () => {},
  });
}
const render = (authors: WorkFormValues["authors"]) =>
  act(() => root.render(createElement(Form, { authors })));
const button = (name: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const click = (el: HTMLElement) => act(() => el.click());
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

const HUYSMANS = { id: "a1", name: "Joris-Karl Huysmans", role: "author" };
const BLOY = { id: "a2", name: "Léon Bloy", role: "co_author" };

it("moves an author up and down, and saves the order", () => {
  render([HUYSMANS, BLOY]);
  expect(button("Move Joris-Karl Huysmans up").disabled).toBe(true);
  expect(button("Move Léon Bloy down").disabled).toBe(true);
  const up = button("Move Léon Bloy up");
  act(() => up.focus());
  click(up);
  expect(latest.authors.map((a) => a.id)).toEqual(["a2", "a1"]);
  // At the top its Move up turns off: the focus goes to its Move down
  expect(document.activeElement).toBe(button("Move Léon Bloy down"));
  const payload = workPayload(latest);
  expect(payload.ok && payload.input.authorIds).toEqual([
    { authorId: "a2", role: "co_author" },
    { authorId: "a1", role: "author" },
  ]);
  click(button("Move Léon Bloy down"));
  expect(latest.authors.map((a) => a.id)).toEqual(["a1", "a2"]);
});

it("keeps the focus on a row moved down, and gives a removed row's focus to the next one", async () => {
  const VILLIERS = { id: "a5", name: "Villiers de l'Isle-Adam", role: "author" };
  render([HUYSMANS, BLOY, VILLIERS]);
  const down = button("Move Joris-Karl Huysmans down");
  act(() => down.focus());
  click(down);
  expect(latest.authors.map((a) => a.id)).toEqual(["a2", "a1", "a5"]);
  expect(document.activeElement).toBe(button("Move Joris-Karl Huysmans down"));
  const remove = button("Remove Joris-Karl Huysmans");
  act(() => remove.focus());
  click(remove);
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(latest.authors.map((a) => a.id)).toEqual(["a2", "a5"]);
  expect(document.activeElement).toBe(button("Remove Villiers de l'Isle-Adam"));
});

it("names each Remove after its person, and explains the last author", () => {
  render([HUYSMANS, BLOY]);
  const names = [...host.querySelectorAll("button[aria-label^='Remove ']")].map((b) => b.getAttribute("aria-label"));
  expect(names).toEqual(["Remove Joris-Karl Huysmans", "Remove Léon Bloy"]);
  click(button("Remove Léon Bloy"));
  expect(latest.authors.map((a) => a.id)).toEqual(["a1"]);
  const last = button("Remove Joris-Karl Huysmans");
  expect(last.disabled).toBe(false);
  click(last);
  expect(toast.error).toHaveBeenCalledWith("A book needs at least one author");
  expect(latest.authors).toHaveLength(1);
});

it("picks an author from the search with the keyboard alone", () => {
  search.results = [
    { id: "a3", name: "Villiers de l'Isle-Adam" },
    { id: "a4", name: "Barbey d'Aurevilly" },
  ];
  render([HUYSMANS]);
  click([...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add author")!);
  const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  type(input, "Vi");
  expect(input.getAttribute("aria-expanded")).toBe("true");
  const options = () => [...host.querySelectorAll('[role="option"]')];
  // The two authors, then "Create" for the typed name
  expect(options().map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  expect(options()[2]!.textContent).toContain("Create");
  expect(key(input, "ArrowDown").defaultPrevented).toBe(true);
  expect(input.getAttribute("aria-activedescendant")).toBe(options()[1]!.id);
  expect(key(input, "Enter").defaultPrevented).toBe(true);
  expect(latest.authors.map((a) => a.name)).toEqual(["Joris-Karl Huysmans", "Barbey d'Aurevilly"]);
});

it("adds nothing on Enter while the search for the typed name is still out", () => {
  search.results = [{ id: "a3", name: "Villiers de l'Isle-Adam" }];
  search.searching = true;
  try {
    render([HUYSMANS]);
    click([...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add author")!);
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    type(input, "Vix");
    expect(key(input, "Enter").defaultPrevented).toBe(true);
    expect(latest.authors.map((a) => a.id)).toEqual(["a1"]);
  } finally {
    search.searching = false;
  }
});

it("closes the search on Escape without leaving the form", () => {
  render([HUYSMANS]);
  click([...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add author")!);
  const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  expect(key(input, "Escape").defaultPrevented).toBe(true);
  expect(host.querySelector('input[role="combobox"]')).toBeNull();
});

it("moves a row one place, and leaves the ends alone", () => {
  expect(moveRow(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
  expect(moveRow(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  expect(moveRow(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  expect(moveRow(["a", "b"], 1, 1)).toEqual(["a", "b"]);
});

// Review of #341: names wrap in full beside the controls. This pins the row's markup.
it("wraps an author's name in full, on a line of its own on touch and on a phone", () => {
  const controls = readFileSync(path.resolve(__dirname, "../../components/shared/credit-row-controls.tsx"), "utf8");
  expect(controls).not.toContain("truncate");
  expect(controls).toMatch(/CREDIT_ROW_NAME =\s*"min-w-0 flex-1 whitespace-normal break-words [^"]*pointer-coarse:basis-full [^"]*max-sm:basis-full"/);
  expect(controls).toContain("pointer-coarse:size-11");
});
