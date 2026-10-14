// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReviewCandidate, ReviewQueueRow } from "@/lib/ebooks/review-queue/types";
import { effectWords } from "@/lib/ebooks/review/effect-line";
import { initialReviewDecision } from "@/lib/ebooks/review-queue/decision-state";
import { reviewRow, workId } from "../ebooks/review-ui-fixtures";

// The review queue in plain words, with one recommended choice per row (SLN-684).
const api = vi.hoisted(() => ({ search: vi.fn(), options: vi.fn() }));
vi.mock("@/lib/actions/collections", () => ({ searchWorksForCollection: api.search }));
vi.mock("@/lib/actions/ebook-review-ui", () => ({ readReviewWorkOptions: api.options }));
const { ReviewRow, recommendedAction } = await import("@/components/ebooks/review-row");
const { ChooseBookFields, rankBooks } = await import("@/components/ebooks/choose-book-dialog");
const { ReviewDecisionControls } = await import("@/components/ebooks/review-confirm");

function candidate(): ReviewCandidate {
  return { rank: 1, workId, title: "Nadja", slug: "nadja", authors: ["André Breton"], language: "fr", year: 1928,
    status: "on_order", probability: 0.91, rule: "link", modelVersion: 1, flags: [], reasons: [], editionCount: 1,
    editions: [{ id: "66666666-6666-4666-8666-666666666666", title: "Nadja", isbn13: null, language: "fr",
      publisher: null, year: 1928, placeholder: false, locked: false, copyCount: 1, copies: [] }] };
}
const withCandidate = (): ReviewQueueRow => ({ ...reviewRow(), tier: "likely", candidates: [candidate()] });

let root: Root; let host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { vi.resetAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("button")];
function renderRow(row: ReviewQueueRow, section: Parameters<typeof recommendedAction>[0], onAction = vi.fn()) {
  act(() => root.render(createElement(ReviewRow, { row, section, selected: false, focused: false, busy: false, returnTo: "/ebooks/review",
    onSelect: vi.fn(), onFocus: vi.fn(), onAction, onUndo: vi.fn() })));
  return onAction;
}

describe("one recommended choice per row", () => {
  it("recommends what the section says the eBook most likely is", () => {
    expect(recommendedAction("duplicate", reviewRow())).toBe("exclude");
    expect(recommendedAction("not_a_book", reviewRow())).toBe("exclude");
    expect(recommendedAction("not_in_durtal", reviewRow())).toBe("keep");
    expect(recommendedAction("likely", withCandidate())).toBe("accept");
    expect(recommendedAction("to_choose", reviewRow())).toBe("choose");
  });
  it("shows the recommendation as the only main button and the rest under Other choices", () => {
    const onAction = renderRow(reviewRow(), "duplicate");
    const primary = buttons().filter((button) => button.className.includes("bg-action-fill"));
    expect(primary.map((button) => button.textContent)).toEqual(["Set aside"]);
    expect(buttons().map((button) => button.textContent)).not.toContain("Choose a book…");
    act(() => buttons().find((button) => button.textContent === "Other choices")!.click());
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => {
      const label = item.cloneNode(true) as HTMLElement; label.querySelector(".dropdown-shortcut")?.remove(); return label.textContent; });
    expect(items).toEqual(["Choose a book…", "New book", "Keep as eBook", "Match again"]);
    act(() => (document.querySelector('[role="menuitem"]') as HTMLElement).click());
    expect(onAction).toHaveBeenCalledWith("choose");
  });
  it("makes the proposed book's Review this match the main button when there is one", () => {
    renderRow(withCandidate(), "likely");
    const primary = buttons().filter((button) => button.className.includes("bg-action-fill"));
    expect(primary.map((button) => button.textContent)).toEqual(["Review this match"]);
  });
  it("names counts and statuses in plain words", () => {
    renderRow(withCandidate(), "likely");
    expect(host.textContent).toContain("1 edition");
    expect(host.textContent).not.toContain("1 editions");
    expect(host.textContent).toContain("1 copy");
    expect(host.textContent).toContain("On Order");
    expect(host.textContent).not.toContain("on_order");
  });
});

describe("effect lines", () => {
  it("names the language and puts what happened in the past", () => {
    const text = "Adds an edition in fr without an ISBN and a digital copy of Nadja";
    expect(effectWords(text)).toBe("Adds an edition in French without an ISBN and a digital copy of Nadja");
    expect(effectWords(text, "done")).toBe("Added an edition in French without an ISBN and a digital copy of Nadja");
    expect(effectWords("Moves the digital copy to the identified edition of Nadja and fills it", "done"))
      .toBe("Moved the digital copy to the identified edition of Nadja and filled it");
    expect(effectWords("Kept as a standalone eBook.", "done")).toBe("Kept as a standalone eBook.");
  });
});

describe("Choose a book", () => {
  it("puts exact and starting titles first, ignoring case and accents", () => {
    const books = [{ title: "The Nadja Letters" }, { title: "Nadja and After" }, { title: "NÁDJA" }];
    expect(rankBooks(books, "nadja").map((book) => book.title)).toEqual(["NÁDJA", "Nadja and After", "The Nadja Letters"]);
  });
  it("starts from the eBook's title, searched, and says when nothing matches", async () => {
    api.search.mockResolvedValue([]);
    act(() => root.render(createElement(ChooseBookFields, { row: { ...reviewRow(), title: "Nadja: A Novel" }, onPrepare: vi.fn(), disabled: false })));
    await wait();
    expect(api.search).toHaveBeenCalledWith("Nadja", "book", 30);
    expect(host.querySelector("input")?.value).toBe("Nadja");
    expect(host.textContent).toContain("No book matches “Nadja”");
  });
});

describe("dialog problems", () => {
  it("lists only the problems its fields do not show, and no second error line", () => {
    const issues = [
      { ebookId: reviewRow().id, field: "language" as const, code: "missing", message: "Choose a known language." },
      { ebookId: reviewRow().id, field: "file" as const, code: "missing", message: "Choose an available verified eBook file." },
    ];
    act(() => root.render(createElement(ReviewDecisionControls, { fields: ["language"], onClose: vi.fn(), onConfirm: vi.fn(), onEdit: vi.fn(),
      state: { ...initialReviewDecision, issues, error: "Check the selected book, author, language and ISBN." } })));
    expect(host.textContent).toContain("Choose an available verified eBook file.");
    expect(host.textContent).not.toContain("Choose a known language.");
    expect(host.textContent).not.toContain("Check the selected book");
  });
});
