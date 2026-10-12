// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseReviewParams } from "@/lib/ebooks/review-queue/params";
import { REVIEW_SECTIONS, type ReviewQueue } from "@/lib/ebooks/review-queue/types";
import { ebookId, operation, reviewRow, workId } from "../ebooks/review-ui-fixtures";
import { preparedUnlink, unlinkOutcome } from "../ebooks/review-unlink-ui-fixtures";
const api = vi.hoisted(() => ({ prepareReviewUnlinkUi: vi.fn(), confirmReviewUnlinkUi: vi.fn(),
  prepareReviewUi: vi.fn(), readReviewUi: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-unlink-ui", () => api);
vi.mock("@/lib/actions/ebook-review-ui", () => ({ prepareReviewUi: api.prepareReviewUi, readReviewUi: api.readReviewUi,
  confirmReviewUi: vi.fn(), undoReviewUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-selection-ui", () => ({ prepareReviewSelectionUi: vi.fn(), prepareAcceptReviewSelectionUi: vi.fn(), confirmReviewSelectionUi: vi.fn(), undoReviewSelectionUi: vi.fn() }));
vi.mock("@/lib/actions/work-review-ui", () => ({ prepareWorkReviewUi: vi.fn(), confirmWorkReviewUi: vi.fn(), undoWorkReviewUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-pages-ui", () => ({ readReviewSelectionPageUi: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: api.refresh }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children }: { children: ReactNode }) => createElement("div", { role: "dialog" }, children) }));
vi.mock("@/components/ebooks/new-book-dialog", () => ({ NewBookFields: () => null }));
vi.mock("@/components/ebooks/choose-book-dialog", () => ({ ChooseBookFields: () => null }));
import { ReviewView } from "@/app/(catalogue)/ebooks/review/review-view";
let root: Root; let host: HTMLElement;
const secondId = "66666666-6666-4666-8666-666666666666";
const linked = () => ({ ...reviewRow(), state: "linked" as const, matching: { operation, automatic: true },
  work: { id: workId, title: "Nadja", slug: "nadja", status: "accessioned" } });
function queue(returned = false): ReviewQueue {
  const counts = Object.fromEntries(REVIEW_SECTIONS.map(({ key }) => [key, key === "automatic" && !returned ? 1 : key === "not_in_durtal" ? (returned ? 2 : 1) : 0])) as ReviewQueue["counts"];
  return { counts, sections: [
    ...(returned ? [] : [{ key: "automatic" as const, rows: [linked()] }]),
    { key: "not_in_durtal", rows: [...(returned ? [{ ...reviewRow(), stamp: { ...reviewRow().stamp!, updatedAt: "2026-10-10T10:00:00.000002Z" } }] : []),
      { ...reviewRow(), id: secondId, title: "Second book" }] },
  ] };
}
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks(); api.readReviewUi.mockResolvedValue({ ok: false, error: { code: "unavailable", message: "Unavailable", retryOriginal: false } });
  api.prepareReviewUnlinkUi.mockResolvedValue({ ok: true, value: preparedUnlink() });
  api.confirmReviewUnlinkUi.mockResolvedValueOnce({ ok: false, error: { code: "outcome_unknown_retry_original", message: "Unknown", retryOriginal: true } });
  api.confirmReviewUnlinkUi.mockResolvedValueOnce({ ok: true, value: unlinkOutcome() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(ReviewView, { queue: queue(), params: parseReviewParams({}) })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function click(label: string) { await act(async () => {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label}`); found.click();
}); }
describe("mounted automatic link to fresh review receipt", () => {
  it("blocks unrelated writes on unknown, keeps native identity and lets the authoritative pending row return without an inverse", async () => {
    await click("Undo automatic link…"); expect(api.prepareReviewUnlinkUi).not.toHaveBeenCalled();
    await click("Preview automatic Undo"); expect(api.prepareReviewUnlinkUi.mock.calls[0][0].intent.originalMatchingOperation).toEqual(operation);
    await click("Confirm return to review"); await click("Keep as eBook"); expect(api.prepareReviewUi).not.toHaveBeenCalled();
    expect(api.refresh).not.toHaveBeenCalled(); expect(host.querySelector(`[data-review-row="${ebookId}"]`)?.textContent).toContain("Linked to");
    await click("Retry this unlink decision"); expect(api.confirmReviewUnlinkUi.mock.calls[0]).toEqual(api.confirmReviewUnlinkUi.mock.calls[1]);
    expect(api.refresh).toHaveBeenCalledOnce(); await click("Close");
    expect(host.querySelector('[aria-label="Recent decisions"]')?.textContent).toContain("Kept the copy");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Undo" || item.textContent === "Undo decision")).toBe(false);
    await act(async () => root.render(createElement(ReviewView, { queue: queue(true), params: parseReviewParams({}) })));
    const returned = host.querySelector(`[data-review-row="${ebookId}"]`);
    expect(returned).not.toBeNull(); expect(returned?.textContent).toContain("Choose a book");
    expect(returned?.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false);
  });
});
