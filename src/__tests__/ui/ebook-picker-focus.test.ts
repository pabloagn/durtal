// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

// Link an eBook: the search field was disabled while a search ran, so Enter
// in it dropped focus out of the dialog onto the page.

let finish: (value: unknown) => void = () => {};
vi.mock("@/lib/actions/ebook-review-ui", () => ({
  searchReviewEbooksUi: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
}));

import { EbookPicker } from "@/components/ebooks/ebook-picker";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const field = () => host.querySelector("input") as HTMLInputElement;
const searchButton = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Search"))!;

describe("finding an eBook to link", () => {
  it("keeps focus in the field while the search runs", async () => {
    act(() => root.render(h(EbookPicker, { value: null, onChange: () => {} })));
    field().focus();
    act(() => {
      field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(field().disabled).toBe(false);
    expect(document.activeElement).toBe(field());
    expect(searchButton().getAttribute("aria-busy")).toBe("true");
    await act(async () => finish({ ok: true, value: [] }));
    expect(document.activeElement).toBe(field());
    expect(searchButton().getAttribute("aria-busy")).toBeNull();
  });

  it("moves focus to the field when Search is pressed", async () => {
    act(() => root.render(h(EbookPicker, { value: null, onChange: () => {} })));
    searchButton().focus();
    act(() => searchButton().click());
    await settle();
    expect(document.activeElement).toBe(field());
    await act(async () => finish({ ok: true, value: [] }));
  });
});
