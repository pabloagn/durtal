// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditionWithRelations } from "@/lib/types/index";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/editions", () => ({ updateEdition: vi.fn() }));
vi.mock("@/lib/activity/refresh-event", () => ({ triggerActivityRefresh: vi.fn() }));
vi.mock("@/hooks/use-edit-options", () => ({
  preloadEditOptions: vi.fn(),
  useEditOptions: () => ({ options: { genres: [], tags: [] }, loading: false, failed: false, retry: vi.fn() }),
}));
vi.mock("@/lib/catalogue/edit-options", () => ({ EDITION_GROUPS: [], withChosen: (_options: unknown[], chosen: unknown[]) => chosen }));
vi.mock("@/lib/s3/media-url", () => ({ mediaUrl: vi.fn() }));
vi.mock("@/components/shared/options-notice", () => ({ OptionsNotice: () => null }));
vi.mock("@/components/books/edition-form", () => ({
  editionPayload: vi.fn(),
  EditionForm: ({ initialValues }: { initialValues: { title: string } }) =>
    createElement("form", null, createElement("input", { name: "title", "aria-label": "Edition title", defaultValue: initialValues.title })),
}));

import { EditionEditDialog } from "@/app/(catalogue)/library/[slug]/edition-edit-dialog";

const edition = {
  id: "97900000-0000-4000-8000-000000000001",
  title: "Synthetic edition",
  contributors: [],
  editionGenres: [],
  editionTags: [],
} as unknown as EditionWithRelations;
let host: HTMLElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(EditionEditDialog, { edition })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const opener = () => host.querySelector<HTMLButtonElement>('[data-tooltip="Edit edition"]')!;
const input = () => host.querySelector<HTMLInputElement>('input[name="title"]')!;
const escape = () => act(async () => {
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await Promise.resolve();
});
const click = (button: HTMLButtonElement) => act(async () => {
  // dispatchEvent deliberately does not focus the target, as Safari's
  // pointer activation does not. The mounted opener must establish it.
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await Promise.resolve();
});
const namedButton = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === name)!;

describe("Edit edition opener focus", () => {
  it("records a pointer opener while body has focus and restores it after Escape", async () => {
    expect(document.activeElement).toBe(document.body);
    const button = opener();
    const focused = vi.fn();
    button.addEventListener("focus", focused);
    await click(button);
    expect(focused).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input());
    await escape();
    expect(host.querySelector("dialog[open]")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("keeps the keyboard opener when it already has focus", async () => {
    const button = opener();
    act(() => button.focus());
    await click(button);
    expect(document.activeElement).toBe(input());
    await escape();
    expect(document.activeElement).toBe(button);
  });

  it("keeps the draft and field focus, then restores the opener after Discard", async () => {
    const button = opener();
    await click(button);
    const field = input();
    act(() => {
      // The draft records the value before the person's first edit.
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      field.value = "A changed edition";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await escape();
    expect(host.textContent).toContain("Unsaved changes");
    await click(namedButton("Keep editing"));
    expect(field.value).toBe("A changed edition");
    expect(document.activeElement).toBe(field);
    await escape();
    await click(namedButton("Discard"));
    expect(host.querySelector("dialog[open]")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
