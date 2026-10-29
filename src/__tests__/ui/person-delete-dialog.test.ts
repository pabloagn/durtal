// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
const actions = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/lib/actions/catalogue-client", () => ({ getPersonDeletionRefusal: actions.check }));
import { PersonDeleteDialog } from "@/components/authors/person-delete-dialog";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute("open", ""); };
});
let root: Root, host: HTMLElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); actions.check.mockReset(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const deletion = () => [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "Delete");
const render = async (onConfirm = vi.fn(async () => {})) => {
  await act(async () => root.render(createElement(PersonDeleteDialog, { authorId: "person", name: "Named person", onClose: () => {}, onConfirm })));
  return onConfirm;
};
it("offers no Delete while checking or when current credits block it", async () => {
  let resolve!: (reason: string | null) => void;
  actions.check.mockReturnValue(new Promise<string | null>(done => { resolve = done; }));
  await render();
  expect(host.textContent).toContain("Checking their credits");
  expect(deletion()).toBeUndefined();
  await act(async () => resolve("Credited on 2 films. Remove those credits first."));
  expect(host.textContent).toContain("Credited on 2 films");
  expect(deletion()).toBeUndefined();
});
it("allows a verified unblocked deletion and states the book-only consequence", async () => {
  actions.check.mockResolvedValue(null);
  const confirm = await render();
  expect(host.textContent).toContain("Their books and editions stay");
  expect(deletion()).toBeDefined();
  await act(async () => deletion()!.click());
  expect(confirm).toHaveBeenCalledOnce();
});
it("keeps deletion unavailable when the current credit check fails", async () => {
  actions.check.mockRejectedValue(new Error("network"));
  await render();
  expect(host.textContent).toContain("Could not check their credits");
  expect(deletion()).toBeUndefined();
});
