// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The card's reading in its status slot (SLN-449).

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/library" }));

import { BookCard } from "@/components/books/book-card";
import { CardReading } from "@/components/books/card-status";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const card = {
  workId: "w1",
  slug: "watt",
  title: "Watt",
  authorName: "Samuel Beckett",
  instanceCount: 2,
  catalogueStatus: "accessioned",
  acquisitionPriority: "high",
  rating: 4,
};

describe("CardReading", () => {
  it("replaces the status while a reading is open, and extends its tooltip", () => {
    act(() => root.render(createElement(BookCard, { ...card, reading: { state: "reading", percent: 44.17 } })));
    const slot = host.querySelector("[data-card-reading]") as HTMLElement;
    expect(slot.textContent).toBe("Reading 44%");
    expect(slot.getAttribute("data-tooltip")).toBe("Accessioned · High priority · 2 copies · Reading, 44%");
    expect(slot.querySelector(".bg-accent-blue")).not.toBeNull();
    expect(host.textContent).not.toContain("Accessioned");
  });

  it("reads Paused with a secondary dot, and Reading with no percent", () => {
    act(() => root.render(createElement(CardReading, { reading: { state: "paused", percent: 12.4 }, status: "wanted" })));
    expect(host.textContent).toBe("Paused 12%");
    expect(host.querySelector(".bg-fg-secondary")).not.toBeNull();
    expect(host.querySelector("[data-tooltip]")!.getAttribute("data-tooltip")).toBe("Wanted · Paused, 12%");
    act(() => root.render(createElement(CardReading, { reading: { state: "reading", percent: null }, status: "accessioned" })));
    expect(host.textContent).toBe("Reading");
  });

  it("leaves the status alone without a reading", () => {
    act(() => root.render(createElement(BookCard, card)));
    expect(host.querySelector("[data-card-reading]")).toBeNull();
    expect(host.textContent).toContain("Accessioned");
  });
});
