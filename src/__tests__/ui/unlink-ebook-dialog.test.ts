// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ebookId, stamp, operation } from "../ebooks/review-ui-fixtures";
import { preparedUnlink, unlinkOutcome, unlinkTarget } from "../ebooks/review-unlink-ui-fixtures";
const api = vi.hoisted(() => ({ prepareReviewUnlinkUi: vi.fn(), confirmReviewUnlinkUi: vi.fn() }));
const review = vi.hoisted(() => ({ readReviewStampUi: vi.fn(), prepareReviewUi: vi.fn(), confirmReviewUi: vi.fn(), undoReviewUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-unlink-ui", () => api);
vi.mock("@/lib/actions/ebook-review-ui", () => review);
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children, onClose }: { children: ReactNode; onClose: () => void }) =>
  createElement("div", { role: "dialog" }, children, createElement("button", { onClick: onClose }, "Dismiss")) }));
import { UnlinkEbookDialog, removedWords } from "@/components/ebooks/unlink-ebook-dialog";
import { chooseBookNext } from "@/components/ebooks/choose-book-next";
let root: Root; let host: HTMLElement;
const callbacks = { onClose: vi.fn(), onCommitted: vi.fn() };
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks(); api.prepareReviewUnlinkUi.mockResolvedValue({ ok: true, value: preparedUnlink() });
  api.confirmReviewUnlinkUi.mockResolvedValue({ ok: true, value: unlinkOutcome() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(UnlinkEbookDialog, { target: unlinkTarget, initialMode: "automatic_undo", ...callbacks })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function click(label: string) { await act(async () => {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label}`); found.click();
}); }
describe("actual automatic Undo and fresh Unlink dialog", () => {
  it("prepares the real native identity, displays copy retention and never offers an inverse after commit", async () => {
    await click("Check what changes");
    expect(api.prepareReviewUnlinkUi).toHaveBeenCalledWith({ intent: { ebookId, mode: "automatic_undo", originalMatchingOperation: operation }, stamp });
    expect(host.textContent).toContain("Kept the copy"); expect(host.textContent).toContain("To link it again, choose its book in the review queue.");
    expect(api.confirmReviewUnlinkUi).not.toHaveBeenCalled(); await click("Undo the link");
    expect(callbacks.onCommitted).toHaveBeenCalledWith(unlinkOutcome());
    expect([...host.querySelectorAll("button")].some((item) => /Undo|Confirm|Preview/.test(item.textContent ?? ""))).toBe(false);
  });
  it("locks dismissal and mode changes after uncertainty, retrying the exact capability without preparing again", async () => {
    api.confirmReviewUnlinkUi.mockResolvedValueOnce({ ok: false, error: { retryOriginal: true, message: "Outcome unknown" } });
    await click("Check what changes"); await click("Undo the link"); await click("Dismiss");
    expect(callbacks.onClose).not.toHaveBeenCalled(); expect(callbacks.onCommitted).not.toHaveBeenCalled();
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Unlink instead")).toBe(false);
    await click("Try again");
    const input = { request: preparedUnlink().request, previewToken: preparedUnlink().previewToken };
    expect(api.confirmReviewUnlinkUi.mock.calls).toEqual([[input], [input]]);
    expect(api.prepareReviewUnlinkUi).toHaveBeenCalledOnce();
  });
  it("offers fresh Unlink only after an explicit mode choice and another visible preview", async () => {
    api.prepareReviewUnlinkUi.mockResolvedValueOnce({ ok: false, error: { code: "stale_review", retryOriginal: false, message: "Automatic link has a later edit" } });
    api.prepareReviewUnlinkUi.mockResolvedValueOnce({ ok: true, value: preparedUnlink("unlink") });
    await click("Check what changes"); expect(host.textContent).toContain("later edit");
    await click("Unlink instead"); expect(api.prepareReviewUnlinkUi).toHaveBeenCalledOnce();
    await click("Check what changes"); expect(api.prepareReviewUnlinkUi).toHaveBeenLastCalledWith({ intent: { ebookId, mode: "unlink", originalMatchingOperation: operation }, stamp });
    expect(api.confirmReviewUnlinkUi).not.toHaveBeenCalled(); await click("Unlink");
    expect(api.confirmReviewUnlinkUi).toHaveBeenCalledOnce();
  });
  it("ignores a cancelled late preview", async () => {
    let resolve!: (value: unknown) => void;
    api.prepareReviewUnlinkUi.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await click("Check what changes"); await click("Dismiss");
    await act(async () => resolve({ ok: true, value: preparedUnlink() }));
    expect(callbacks.onClose).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain("What happens");
    expect(api.confirmReviewUnlinkUi).not.toHaveBeenCalled();
  });
  it("prevents repeat confirmation or dismissal while the original write is in flight", async () => {
    let resolve!: (value: unknown) => void;
    api.confirmReviewUnlinkUi.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await click("Check what changes"); await click("Undo the link"); await click("Dismiss"); await click("Undo the link");
    expect(callbacks.onClose).not.toHaveBeenCalled(); expect(api.confirmReviewUnlinkUi).toHaveBeenCalledOnce();
    expect(callbacks.onCommitted).not.toHaveBeenCalled(); await act(async () => resolve({ ok: true, value: unlinkOutcome() }));
    expect(callbacks.onCommitted).toHaveBeenCalledWith(unlinkOutcome());
  });
  it("unlinks, then keeps it as an eBook when asked, with an Undo of the keep (SLN-684)", async () => {
    await act(async () => root.render(createElement(UnlinkEbookDialog, { key: "fresh", target: unlinkTarget, initialMode: "unlink", ...callbacks })));
    const kept = { ...unlinkOutcome(), message: "Kept as a standalone eBook.", undo: { available: true, originalOperation: operation } };
    review.readReviewStampUi.mockResolvedValue({ ok: true, value: stamp });
    review.prepareReviewUi.mockResolvedValue({ ok: true, value: { request: { action: "keep" }, previewToken: "keep-token" } });
    review.confirmReviewUi.mockResolvedValue({ ok: true, value: kept });
    review.undoReviewUi.mockResolvedValue({ ok: true, value: { ...kept, message: "Returned to review." } });
    await act(async () => (host.querySelector('input[value="keep"]') as HTMLInputElement).click());
    api.prepareReviewUnlinkUi.mockResolvedValueOnce({ ok: true, value: preparedUnlink("unlink") });
    await click("Check what changes"); expect(host.textContent).toContain("Then keeps it as an eBook.");
    expect(host.textContent).toContain("Takes the eBook off its book."); expect(host.textContent).not.toContain("Returns the eBook to review.");
    await click("Unlink");
    expect(review.prepareReviewUi).toHaveBeenCalledWith({ intent: { action: "keep", ebookId }, stamp });
    expect(review.confirmReviewUi).toHaveBeenCalledWith({ request: { action: "keep" }, previewToken: "keep-token" });
    expect(callbacks.onCommitted.mock.calls.map(([outcome]) => outcome.message)).toEqual([unlinkOutcome().message, "Kept as a standalone eBook."]);
    expect(host.textContent).toContain("Unlinked and kept as an eBook.");
    await click("Undo keep");
    expect(review.undoReviewUi).toHaveBeenCalledWith({ ebookId: kept.ebookId, originalOperation: operation });
    expect(host.textContent).toContain("Unlinked. It is back in review.");
  });
  it("changes the book: unlinks, closes and leaves \"Choose a book\" to open for it once (SLN-666)", async () => {
    await act(async () => root.render(createElement(UnlinkEbookDialog, { key: "change", target: unlinkTarget, initialMode: "unlink", change: true, ...callbacks })));
    expect(host.textContent).toContain("then you choose its new one");
    expect((host.querySelector('input[value="choose"]') as HTMLInputElement).checked).toBe(true);
    api.prepareReviewUnlinkUi.mockResolvedValueOnce({ ok: true, value: preparedUnlink("unlink") });
    await click("Check what changes");
    expect(host.textContent).toContain("Then you choose its new book."); expect(host.textContent).toContain("Takes the eBook off its book.");
    await click("Unlink and choose");
    expect(callbacks.onCommitted).toHaveBeenCalledWith(unlinkOutcome()); expect(callbacks.onClose).toHaveBeenCalledOnce();
    expect(review.prepareReviewUi).not.toHaveBeenCalled();
    expect(chooseBookNext.take(ebookId)).toEqual({ workId: null }); expect(chooseBookNext.take(ebookId)).toBe(false);
  });
  it("offers choosing a new book only from \"Change the book…\"", async () => {
    await act(async () => root.render(createElement(UnlinkEbookDialog, { key: "plain", target: unlinkTarget, initialMode: "unlink", ...callbacks })));
    expect(host.querySelector('input[value="choose"]')).toBeNull();
    expect((host.querySelector('input[value="review"]') as HTMLInputElement).checked).toBe(true);
  });
  it("makes the unlink itself a danger button, so Enter alone never confirms it", async () => {
    await click("Check what changes");
    const unlink = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Undo the link")!;
    expect(unlink.dataset.variant).toBe("danger");
    expect(unlink.dataset.shortcut).toBe("save");
    expect(host.querySelectorAll('button[data-variant="primary"]')).toHaveLength(0);
  });
  it("offers Link it back after an unlink that keeps its book, opening the eBook's page on that book (SLN-684)", async () => {
    const target = { ...unlinkTarget, book: { workId: "88888888-8888-4888-8888-888888888888", title: "Nadja (book)" } };
    await act(async () => root.render(createElement(UnlinkEbookDialog, { key: "back", target, initialMode: "unlink", ...callbacks })));
    api.prepareReviewUnlinkUi.mockResolvedValueOnce({ ok: true, value: preparedUnlink("unlink") });
    await click("Check what changes");
    expect(host.textContent).toContain("Afterwards, Link it back chooses “Nadja (book)” again.");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Link it back")).toBe(false);
    await click("Unlink"); await click("Link it back");
    expect(callbacks.onClose).toHaveBeenCalledOnce(); expect(nav.push).toHaveBeenCalledWith(`/ebooks/${ebookId}`);
    expect(chooseBookNext.take(ebookId)).toEqual({ workId: "88888888-8888-4888-8888-888888888888" });
  });
  it("offers no Link it back when the unlink removes the book, or the book is unknown", async () => {
    const target = { ...unlinkTarget, book: { workId: "88888888-8888-4888-8888-888888888888", title: "Nadja (book)" } };
    await act(async () => root.render(createElement(UnlinkEbookDialog, { key: "gone", target, initialMode: "unlink", ...callbacks })));
    const removing = preparedUnlink("unlink");
    api.prepareReviewUnlinkUi.mockResolvedValueOnce({ ok: true, value: { ...removing, preview: { ...removing.preview, deleted: { ...removing.preview.deleted, books: 1 } } } });
    await click("Check what changes");
    expect(host.textContent).toContain("To link it again, choose its book in the review queue.");
    await click("Unlink");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Link it back")).toBe(false);
    await act(async () => root.render(createElement(UnlinkEbookDialog, { key: "unknown", target: unlinkTarget, initialMode: "unlink", ...callbacks })));
    api.prepareReviewUnlinkUi.mockResolvedValueOnce({ ok: true, value: preparedUnlink("unlink") });
    await click("Check what changes"); await click("Unlink");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Link it back")).toBe(false);
  });
  it("names what an unlink removes in words, leaving out what it keeps", () => {
    expect(removedWords({ copies: 1, editions: 1, books: 0, authors: 0, series: 0 })).toBe("1 copy and 1 edition");
    expect(removedWords({ copies: 2, editions: 1, books: 1, authors: 0, series: 1 })).toBe("2 copies, 1 edition, 1 book and 1 series");
    expect(removedWords({ copies: 0, editions: 0, books: 0, authors: 0, series: 0 })).toBeNull();
  });
});

// Link it back on the eBook's own page: its controls already show it
// unlinked and are not mounted again, so they hear of the choice (#303 review)
describe("chooseBookNext listeners", () => {
  it("tells a page already showing the eBook, once, and stops after unsubscribe", () => {
    const heard = vi.fn(() => chooseBookNext.take(ebookId));
    const stop = chooseBookNext.subscribe(heard);
    chooseBookNext.set(ebookId, "88888888-8888-4888-8888-888888888888");
    expect(heard).toHaveBeenCalledTimes(1); expect(heard).toHaveReturnedWith({ workId: "88888888-8888-4888-8888-888888888888" });
    expect(chooseBookNext.take(ebookId)).toBe(false);
    stop(); chooseBookNext.set(ebookId); expect(heard).toHaveBeenCalledTimes(1);
    expect(chooseBookNext.take(ebookId)).toEqual({ workId: null });
  });
});
