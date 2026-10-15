// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { reviewRow, workId, ebookId } from "../ebooks/review-ui-fixtures";
import type { ReviewWorkOptions } from "@/lib/ebooks/review-queue/types";

const api = vi.hoisted(() => ({ searchWorksForCollection: vi.fn(), searchAuthorsLite: vi.fn(), readReviewWorkOptions: vi.fn() }));
vi.mock("@/lib/actions/collections", () => ({ searchWorksForCollection: api.searchWorksForCollection }));
vi.mock("@/lib/actions/authors", () => ({ searchAuthorsLite: api.searchAuthorsLite }));
vi.mock("@/lib/actions/ebook-review-ui", () => ({ readReviewWorkOptions: api.readReviewWorkOptions }));
vi.mock("@/components/ui/select", () => ({ Select: ({ options, label, ...props }: { options: { value: string; label: string }[]; label: string }) =>
  createElement("label", null, label, createElement("select", { ...props, "aria-label": label },
    ...options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label)))) }));
import { ChooseBookFields } from "@/components/ebooks/choose-book-dialog";
import { NewBookFields } from "@/components/ebooks/new-book-dialog";

let root: Root; let host: HTMLElement;
const editionId = "66666666-6666-4666-8666-666666666666";
const copyId = "77777777-7777-4777-8777-777777777777";
const options: ReviewWorkOptions = { workId, title: "Nadja", editionCount: 1, locations: [], isbnHolders: [],
  editions: [{ id: editionId, title: "Nadja", isbn13: null, language: "fr", publisher: null, year: 1928,
    placeholder: true, locked: false, copyCount: 1, copies: [{ id: copyId, format: "ebook", location: "eBooks", canFill: true }] }] };
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.resetAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  api.searchWorksForCollection.mockResolvedValue([{ workId, title: "Nadja", kind: "book", creators: "André Breton", imageS3Key: null }]);
  api.readReviewWorkOptions.mockResolvedValue({ ok: true, value: options });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function click(text: string) {
  await act(async () => { const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(text));
    if (!button) throw new Error(`Missing button: ${text}`); button.click(); });
}
describe("real book and author choice mapping", () => {
  it("searches only books and prepares the selected existing digital copy identity", async () => {
    const onPrepare = vi.fn();
    await act(async () => root.render(createElement(ChooseBookFields, { row: reviewRow(), disabled: false, onPrepare })));
    const input = host.querySelector("input")!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Nadja"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(api.searchWorksForCollection).toHaveBeenCalledWith("Nadja", "book", 30);
    await click("Nadja");
    expect(api.readReviewWorkOptions).toHaveBeenCalledWith({ workId, ebookId });
    await act(async () => host.querySelector<HTMLInputElement>('input[name="edition-choice"]')!.click());
    await act(async () => [...host.querySelectorAll("form")].at(-1)!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onPrepare).toHaveBeenCalledWith({ action: "link", ebookId, workId, choice: { kind: "fill_copy", editionId, instanceId: copyId } });
  });
  it("opens on the book it was unlinked from, and goes back to a search from it (SLN-684)", async () => {
    await act(async () => root.render(createElement(ChooseBookFields, { row: reviewRow(), disabled: false, onPrepare: vi.fn(), startWorkId: workId })));
    expect(api.readReviewWorkOptions).toHaveBeenCalledWith({ workId, ebookId });
    expect(api.searchWorksForCollection).not.toHaveBeenCalled();
    expect(host.querySelector('input[name="edition-choice"]')).not.toBeNull();
    await click("Choose another book");
    expect(api.searchWorksForCollection).toHaveBeenCalledOnce();
    expect(host.querySelector('input[name="edition-choice"]')).toBeNull();
    expect(host.querySelector('[aria-label="Book search results"]')!.textContent).toContain("André Breton");
  });
  it("offers no new-edition ISBN that is held elsewhere", async () => {
    api.readReviewWorkOptions.mockResolvedValue({ ok: true, value: { ...options,
      isbnHolders: [{ isbn13: "9782070368228", workId, title: "Other book" }] } });
    await act(async () => root.render(createElement(ChooseBookFields, { row: { ...reviewRow(), isbns: ["9782070368228"] }, disabled: false, onPrepare: vi.fn() })));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await click("Nadja");
    expect([...host.querySelectorAll("option")].some((option) => option.value === "9782070368228")).toBe(false);
  });
  it("resolves an existing author explicitly and sends the actual id, language and no-ISBN choice", async () => {
    const authorId = "88888888-8888-4888-8888-888888888888";
    api.searchAuthorsLite.mockResolvedValue([{ id: authorId, name: "André Breton" }]);
    const onPrepare = vi.fn();
    await act(async () => root.render(createElement(NewBookFields, { row: reviewRow(), disabled: false, onPrepare })));
    await click("Find existing");
    await act(async () => host.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onPrepare).toHaveBeenCalledWith({ action: "accession", ebookId, authors: [{ id: authorId }], language: "fr", isbn13: null });
  });
  it("highlights an actionable author refusal without losing the chosen identity or language", async () => {
    const authorId = "88888888-8888-4888-8888-888888888888", onPrepare = vi.fn();
    api.searchAuthorsLite.mockResolvedValue([{ id: authorId, name: "André Breton" }]);
    await act(async () => root.render(createElement(NewBookFields, { row: reviewRow(), disabled: false, onPrepare })));
    await click("Find existing"); await act(async () => host.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
    await act(async () => root.render(createElement(NewBookFields, { row: reviewRow(), disabled: false, onPrepare,
      issues: [{ ebookId, field: "authors", code: "author_identity", message: "Choose the intended catalogue author." }] })));
    expect(host.textContent).toContain("Choose the intended catalogue author.");
    expect(host.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true);
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onPrepare).toHaveBeenCalledWith({ action: "accession", ebookId, authors: [{ id: authorId }], language: "fr", isbn13: null });
  });
});
