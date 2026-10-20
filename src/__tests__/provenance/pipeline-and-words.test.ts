// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { readFileSync } from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";

// Design polish 4: the provenance statuses are never cut at the page's edge, the page speaks
// in plain sentence-case words, and no order at all is one empty state
// (SLN-833). The other pages' words: sentence case, no full stop after
// Harmonize, no key hints on touch (SLN-836).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/orders", () => ({ updateOrderStatus: async () => {} }));
vi.mock("@/app/(catalogue)/provenance/order-detail-panel", () => ({ OrderDetailPanel: () => null }));

import { ProvenanceShell, type OrderItem, type ProvenanceStats } from "@/app/(catalogue)/provenance/provenance-shell";

const stats = (orderCount: number): ProvenanceStats => ({
  spentByCurrency: [], orderCount, activeOrders: orderCount, inTransit: 0, arrivingThisWeek: 0,
});
const order = (status: OrderItem["status"]): OrderItem => ({
  id: `o-${status}`, workId: "w", editionId: null, acquisitionTargetId: null,
  work: { id: "w", title: "À rebours, a title long enough to wrap in a narrow column", slug: "a-rebours", kind: "book", workAuthors: [{ author: { id: "a", name: "Joris-Karl Huysmans" } }], media: [] },
  venue: null, acquisitionMethod: "online_order", status, orderDate: "2026-10-01",
  estimatedDeliveryDate: null, actualDeliveryDate: null, shippedDate: null, carrier: null, trackingNumber: null,
  trackingUrl: null, orderUrl: null, orderConfirmation: null, price: null, shippingCost: null, totalCost: null,
  currency: "EUR", notes: null, createdAt: new Date("2026-10-01"),
} as unknown as OrderItem);
const render = (orders: OrderItem[], count: number) =>
  new DOMParser().parseFromString(renderToStaticMarkup(createElement(ProvenanceShell, { activeOrders: orders, stats: stats(count) })), "text/html");

describe("the provenance page", () => {
  it("shows one empty state, not four zeros and an empty board, with no order yet", () => {
    const page = render([], 0);
    expect(page.querySelector("h2")?.textContent).toBe("No orders yet");
    expect(page.body.textContent).toContain("New order");
    expect(page.querySelector("[data-pipeline]")).toBeNull();
    expect(page.body.textContent).not.toMatch(/In transit|Total spent/);
  });

  it("lists one status a row, never a board that scrolls sideways", () => {
    const page = render([order("out_for_delivery")], 1);
    const board = page.querySelector("[data-pipeline]")!;
    expect(board.className.split(" ")).toContain("grid");
    expect(board.closest(".overflow-x-auto")).toBeNull();
    expect(page.querySelectorAll("[data-pipeline-column]")).toHaveLength(7);
    // The title and author wrap in full
    const card = page.querySelector('[data-pipeline-column="out_for_delivery"] button')!;
    expect(card.innerHTML).not.toMatch(/line-clamp|truncate/);
    // Stretched to its row's tallest, a card keeps its content at the top and its footer at the foot
    expect(card.className.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-col"]));
    expect(card.lastElementChild!.className.split(" ")).toContain("mt-auto");
  });

  it("speaks in sentence case, without jargon", () => {
    const text = render([order("placed")], 1).body.textContent!;
    for (const words of ["In transit", "Arriving this week", "Active orders", "Total spent", "Orders in progress", "Out for delivery"]) expect(text).toContain(words);
    expect(text).not.toMatch(/non-terminal|shipped orders|Active Pipeline|In Transit|Out for Delivery/);
  });
});

describe("words elsewhere", () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

  it("uses sentence case on the buttons and headings pass 4 found", () => {
    expect(read("app/(catalogue)/provenance/order-create-dialog.tsx")).not.toContain("New Order");
    for (const file of ["order-create-steps.tsx", "order-edit-dialog.tsx"]) expect(read(`app/(catalogue)/provenance/${file}`)).toContain('"In-store purchase"');
    expect(read("app/(catalogue)/places/venue-create-dialog.tsx")).not.toContain("Add Venue");
    expect(read("app/(catalogue)/taxonomy/[familySlug]/[itemSlug]/page.tsx")).toContain(': "Associated works"');
  });

  it("ends Harmonize without a full stop and hides its key hints on touch", () => {
    expect(read("app/(catalogue)/harmonize/frame.tsx")).not.toContain("h-title-dot");
    const css = read("app/(catalogue)/harmonize/harmonize.css");
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(coarse).toMatch(/\.h-queue-footer \{\s+display: none;/);
  });

  it("asks for a perfume's source in a short placeholder", () => {
    expect(read("components/perfumes/source-link-field.tsx")).toContain('placeholder="Fragrantica or Basenotes link"');
  });
});
