// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Star } from "lucide-react";
import { MarkToggle } from "@/components/books/mark-toggle";
import { CollectionIconPicker } from "@/components/collections/collection-icon-picker";
import { WORK_MARKS } from "@/lib/constants/marks";
import { acquireSurface, hasOpenSurface, hasPaletteBlockingSurface } from "@/lib/ui/surface-state";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/catalogue-client", () => ({ setCollectionIcon: vi.fn() }));
vi.mock("@/components/collections/icon-picker-panel", () => ({ default: () => h("button", null, "An icon") }));
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks();
  expect(hasOpenSurface()).toBe(false);
  expect(hasPaletteBlockingSurface()).toBe(false);
});
const escape = () => act(() => document.activeElement!.dispatchEvent(
  new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
));

it("a mark card owns Escape and stays closed when focus returns from its date field", () => {
  act(() => root.render(h(MarkToggle, {
    mark: WORK_MARKS[0], icon: Star, tone: "text-fg-primary", marked: true,
    date: "2026-10-01", onToggle: vi.fn(), onDateChange: vi.fn(),
  })));
  const button = host.querySelector("button")!;
  const original = button.matches.bind(button);
  vi.spyOn(button, "matches").mockImplementation(selector => selector === ":focus-visible" || original(selector));
  act(() => button.focus());
  expect(hasOpenSurface()).toBe(true);
  expect(hasPaletteBlockingSurface()).toBe(true);
  const change = [...document.querySelectorAll<HTMLButtonElement>("button")].find(n => n.textContent === "Change date")!;
  act(() => change.click());
  act(() => document.querySelector<HTMLInputElement>('input[type="date"]')!.focus());
  escape();
  expect(document.querySelector('[role="group"]')).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(hasOpenSurface()).toBe(false);
  expect(hasPaletteBlockingSurface()).toBe(false);
});

it("an icon picker waits for a newer surface before closing and restores its trigger", async () => {
  act(() => root.render(h(CollectionIconPicker, { collectionId: "test", name: "Books", value: null })));
  const button = host.querySelector("button")!;
  await act(async () => { button.click(); await new Promise(r => setTimeout(r, 10)); });
  expect(document.querySelector('[aria-label="Collection icon"]')).not.toBeNull();
  expect(hasOpenSurface()).toBe(true);
  expect(hasPaletteBlockingSurface()).toBe(true);
  const newerClosed = vi.fn();
  const newer = acquireSurface(newerClosed);
  escape(); expect(newerClosed).toHaveBeenCalledOnce();
  expect(document.querySelector('[aria-label="Collection icon"]')).not.toBeNull();
  newer.release();
  escape();
  expect(document.querySelector('[aria-label="Collection icon"]')).toBeNull();
  expect(document.activeElement).toBe(button);
});


it("keeps a mark card open when the pointer leaves while its controls have focus", async () => {
  act(() => root.render(h(MarkToggle, {
    mark: WORK_MARKS[0], icon: Star, tone: "text-fg-primary", marked: true,
    date: "2026-10-01", onToggle: vi.fn(), onDateChange: vi.fn(),
  })));
  const button = host.querySelector("button")!;
  const original = button.matches.bind(button);
  vi.spyOn(button, "matches").mockImplementation(selector => selector === ":focus-visible" || original(selector));
  act(() => button.focus());
  const card = document.querySelector<HTMLElement>('[role="group"]')!;
  const change = [...card.querySelectorAll<HTMLButtonElement>("button")].find(n => n.textContent === "Change date")!;
  act(() => change.focus());
  act(() => card.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
  await act(() => new Promise(resolve => setTimeout(resolve, 200)));
  expect(document.querySelector('[role="group"]')).toBe(card);
});
