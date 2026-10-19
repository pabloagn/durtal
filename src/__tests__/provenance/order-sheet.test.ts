// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "fs";
import path from "path";

// SLN-1118 (recommenders and acquisitions survey, items 1 and 3): beside the
// board, an order's panel left it 8px wide at 390 and ran 40px past a 320
// screen. Under lg it is a sheet over the board, which is inert until the
// sheet closes. The sheet takes the focus; closing hands it back to the
// order's card, deleting moves it to the next card or New order, and the
// delete question takes it on its safe answer. Each fell to the page body.

const deleteOrder = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/actions/orders", () => ({ updateOrderStatus: async () => {}, deleteOrder }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(catalogue)/provenance/order-edit-dialog", () => ({ OrderEditDialog: () => null }));

import { OrderDetailPanel } from "@/app/(catalogue)/provenance/order-detail-panel";
import { ProvenanceShell, type OrderItem } from "@/app/(catalogue)/provenance/provenance-shell";

const order = (id: string, status: OrderItem["status"] = "placed"): OrderItem => ({
  id, workId: "w", editionId: null, acquisitionTargetId: null,
  work: { id: "w", title: `Book ${id}`, slug: "book", kind: "book", workAuthors: [{ author: { id: "a", name: "Joris-Karl Huysmans" } }], media: [] },
  venue: null, acquisitionMethod: "online_order", status, orderDate: "2026-10-01",
  estimatedDeliveryDate: null, actualDeliveryDate: null, shippedDate: null, carrier: null, trackingNumber: null,
  trackingUrl: null, orderUrl: null, orderConfirmation: null, price: null, shippingCost: null, totalCost: null,
  currency: "EUR", notes: null, createdAt: new Date("2026-10-01"),
} as unknown as OrderItem);
const stats = { spentByCurrency: [], orderCount: 2, activeOrders: 2, inTransit: 0, arrivingThisWeek: 0 };

let host: HTMLDivElement;
let root: Root;
function mount(element: React.ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(element));
}
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name)!;
let wide = false;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({
    matches: query === "(min-width: 1024px)" ? wide : false, media: query,
    addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  deleteOrder.mockClear();
});

describe("an order's panel", () => {
  it("takes the focus as a sheet, on its heading", () => {
    mount(createElement(OrderDetailPanel, { order: order("o1"), onClose: () => {}, onDeleted: () => {}, takeFocus: true }));
    expect(document.activeElement?.textContent).toBe("Order details");
  });

  it("moves the focus to the delete question's Cancel, and back to Delete order on No", () => {
    mount(createElement(OrderDetailPanel, { order: order("o1"), onClose: () => {}, onDeleted: () => {} }));
    act(() => button("Delete order").click());
    expect(document.activeElement).toBe(button("Cancel"));
    const question = host.querySelector('[role="group"]')!;
    expect(host.querySelector(`#${question.getAttribute("aria-labelledby")}`)?.textContent).toContain("Delete this order?");
    act(() => button("Cancel").click());
    expect(document.activeElement).toBe(button("Delete order"));
  });

  it("reports a delete apart from a close, so the focus can skip the gone card", async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    mount(createElement(OrderDetailPanel, { order: order("o1"), onClose, onDeleted }));
    act(() => button("Delete order").click());
    await act(async () => button("Delete").click());
    expect(deleteOrder).toHaveBeenCalledWith("o1");
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the provenance board with an order open", () => {
  const shell = () => createElement(ProvenanceShell, { activeOrders: [order("o1"), order("o2")], stats });
  const card = (id: string) => host.querySelector<HTMLElement>(`[data-order-card="${id}"]`)!;

  it("covers a narrow board with a sheet, the board out of reach until it closes", () => {
    wide = false;
    mount(shell());
    act(() => card("o1").click());
    const sheet = host.querySelector("[data-order-sheet]")!;
    expect(sheet.className.split(" ")).toEqual(expect.arrayContaining(["glass", "fixed", "inset-x-0", "top-12", "overflow-hidden", "md:left-(--sidebar-w)", "md:top-0"]));
    expect(host.querySelector("[data-pipeline]")!.closest("[inert]")).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Order details");
    act(() => button("Close").click());
    expect(host.querySelector("[data-order-sheet]")).toBeNull();
    expect(host.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(card("o1"));
  });

  it("keeps the panel beside a wide board", () => {
    wide = true;
    mount(shell());
    act(() => card("o1").click());
    expect(host.querySelector("[data-order-sheet]")).toBeNull();
    expect(host.querySelector("[inert]")).toBeNull();
    expect(host.querySelector(".w-80")?.textContent).toContain("Order details");
  });

  it("sends the focus on to the next card after a delete, else the one before, else New order", async () => {
    wide = false;
    const create = document.createElement("button");
    create.dataset.focusEmpty = "orders";
    document.body.append(create);
    const remove = async (id: string) => {
      act(() => card(id).click());
      act(() => button("Delete order").click());
      await act(async () => button("Delete").click());
    };
    mount(shell());
    await remove("o1");
    expect(document.activeElement).toBe(card("o2"));
    await remove("o2");
    // The mock keeps o1's card: on the live page it goes with the refresh
    expect(document.activeElement).toBe(card("o1"));
    act(() => root.unmount());
    host.remove();
    mount(createElement(ProvenanceShell, { activeOrders: [order("o3")], stats }));
    await remove("o3");
    expect(document.activeElement).toBe(create);
    create.remove();
  });

  it("marks New order as where the focus goes when the last order goes", () => {
    const dialog = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/provenance/order-create-dialog.tsx"), "utf8");
    expect(dialog).toContain('data-focus-empty="orders"');
  });
});
