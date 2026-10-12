// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ebookId, stamp, operation } from "../ebooks/review-ui-fixtures";
import { preparedUnlink, unlinkOutcome, unlinkTarget } from "../ebooks/review-unlink-ui-fixtures";
const api = vi.hoisted(() => ({ prepareReviewUnlinkUi: vi.fn(), confirmReviewUnlinkUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-unlink-ui", () => api);
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children, onClose }: { children: ReactNode; onClose: () => void }) =>
  createElement("div", { role: "dialog" }, children, createElement("button", { onClick: onClose }, "Dismiss")) }));
import { UnlinkEbookDialog } from "@/components/ebooks/unlink-ebook-dialog";
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
    await click("Preview automatic Undo");
    expect(api.prepareReviewUnlinkUi).toHaveBeenCalledWith({ intent: { ebookId, mode: "automatic_undo", originalMatchingOperation: operation }, stamp });
    expect(host.textContent).toContain("Kept the copy"); expect(host.textContent).toContain("no inverse Undo");
    expect(api.confirmReviewUnlinkUi).not.toHaveBeenCalled(); await click("Confirm return to review");
    expect(callbacks.onCommitted).toHaveBeenCalledWith(unlinkOutcome());
    expect([...host.querySelectorAll("button")].some((item) => /Undo|Confirm|Preview/.test(item.textContent ?? ""))).toBe(false);
  });
  it("locks dismissal and mode changes after uncertainty, retrying the exact capability without preparing again", async () => {
    api.confirmReviewUnlinkUi.mockResolvedValueOnce({ ok: false, error: { retryOriginal: true, message: "Outcome unknown" } });
    await click("Preview automatic Undo"); await click("Confirm return to review"); await click("Dismiss");
    expect(callbacks.onClose).not.toHaveBeenCalled(); expect(callbacks.onCommitted).not.toHaveBeenCalled();
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Choose fresh Unlink instead")).toBe(false);
    await click("Retry this unlink decision");
    const input = { request: preparedUnlink().request, previewToken: preparedUnlink().previewToken };
    expect(api.confirmReviewUnlinkUi.mock.calls).toEqual([[input], [input]]);
    expect(api.prepareReviewUnlinkUi).toHaveBeenCalledOnce();
  });
  it("offers fresh Unlink only after an explicit mode choice and another visible preview", async () => {
    api.prepareReviewUnlinkUi.mockResolvedValueOnce({ ok: false, error: { code: "stale_review", retryOriginal: false, message: "Automatic link has a later edit" } });
    api.prepareReviewUnlinkUi.mockResolvedValueOnce({ ok: true, value: preparedUnlink("unlink") });
    await click("Preview automatic Undo"); expect(host.textContent).toContain("later edit");
    await click("Choose fresh Unlink instead"); expect(api.prepareReviewUnlinkUi).toHaveBeenCalledOnce();
    await click("Preview Unlink"); expect(api.prepareReviewUnlinkUi).toHaveBeenLastCalledWith({ intent: { ebookId, mode: "unlink", originalMatchingOperation: operation }, stamp });
    expect(api.confirmReviewUnlinkUi).not.toHaveBeenCalled(); await click("Confirm return to review");
    expect(api.confirmReviewUnlinkUi).toHaveBeenCalledOnce();
  });
  it("ignores a cancelled late preview", async () => {
    let resolve!: (value: unknown) => void;
    api.prepareReviewUnlinkUi.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await click("Preview automatic Undo"); await click("Dismiss");
    await act(async () => resolve({ ok: true, value: preparedUnlink() }));
    expect(callbacks.onClose).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain("What will be written");
    expect(api.confirmReviewUnlinkUi).not.toHaveBeenCalled();
  });
  it("prevents repeat confirmation or dismissal while the original write is in flight", async () => {
    let resolve!: (value: unknown) => void;
    api.confirmReviewUnlinkUi.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await click("Preview automatic Undo"); await click("Confirm return to review"); await click("Dismiss"); await click("Confirming…");
    expect(callbacks.onClose).not.toHaveBeenCalled(); expect(api.confirmReviewUnlinkUi).toHaveBeenCalledOnce();
    expect(callbacks.onCommitted).not.toHaveBeenCalled(); await act(async () => resolve({ ok: true, value: unlinkOutcome() }));
    expect(callbacks.onCommitted).toHaveBeenCalledWith(unlinkOutcome());
  });
});
