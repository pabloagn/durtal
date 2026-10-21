// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-985, 986, 987: an order's shop was a free text field the save never
// sent, so no order had a shop, the order card never showed one and Edit
// order had no way to set it. It is now one of the places, picked from a
// search, on New order and Edit order alike.
// SLN-989: "Acquisition target" and "Ordered edition" read as the same
// thing, and showed the same edition twice for a hunt for one edition.

const updateOrder = vi.hoisted(() => vi.fn(async () => {}));
const options = vi.hoisted(() => ({
  value: {
    targets: [] as unknown[],
    editions: [] as unknown[],
    matches: [] as { targetId: string; editionId: string }[],
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/actions/catalogue-client", () => ({ updateOrder, createVenue: vi.fn() }));
vi.mock("@/lib/actions/venues", () => ({ searchVenues: async () => [] }));
vi.mock("@/lib/actions/publishers", () => ({ getOrderAcquisitionOptions: async () => options.value }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/hooks/use-app-settings", () => ({ useAppSettings: () => ({ homeCurrency: "EUR" }) }));

import { OrderEditDialog } from "@/app/(catalogue)/provenance/order-edit-dialog";
import { OrderTargetFields } from "@/components/publishers/order-target-fields";

const edition = { id: "e1", title: "Agostino", publisher: "New York Review of Books", isbn13: "9781590177235", language: "en", publicationYear: 2014 };
const order = (over: Record<string, unknown> = {}) => ({
  id: "o1", workId: "w1", work: { kind: "book" }, editionId: null, acquisitionTargetId: null,
  acquisitionMethod: "online_order" as const, status: "placed" as const, orderDate: "2026-10-17",
  orderConfirmation: null, orderUrl: null, price: null, shippingCost: null, totalCost: null, currency: "EUR",
  carrier: null, trackingNumber: null, trackingUrl: null, shippedDate: null, estimatedDeliveryDate: null,
  actualDeliveryDate: null, notes: null, venue: { id: "v1", name: "Amazon.nl" }, ...over,
});

let host: HTMLDivElement;
let root: Root;
async function mount(element: React.ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(element));
}
const labels = () => [...document.querySelectorAll("label")].map((l) => l.textContent?.replace(/\s*\*$/, "").trim());
const shopField = () =>
  [...document.querySelectorAll('[role="group"]')].find((g) => g.firstElementChild?.textContent === "Shop");
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === name)!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  options.value = { targets: [], editions: [edition], matches: [] };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  updateOrder.mockClear();
});

describe("Edit order's shop", () => {
  it("shows the order's shop and saves it", async () => {
    await mount(createElement(OrderEditDialog, { order: order(), open: true, onClose: () => {} }));
    expect(shopField()?.textContent).toContain("Amazon.nl");
    await act(async () => button("Save changes").click());
    expect(updateOrder).toHaveBeenCalledWith("o1", expect.objectContaining({ venueId: "v1" }));
  });

  it("clears the shop when it is removed", async () => {
    await mount(createElement(OrderEditDialog, { order: order(), open: true, onClose: () => {} }));
    const remove = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Remove Amazon.nl")!;
    await act(async () => remove.click());
    await act(async () => button("Save changes").click());
    expect(updateOrder).toHaveBeenCalledWith("o1", expect.objectContaining({ venueId: null }));
  });

  it("has no shop for a gift", async () => {
    await mount(createElement(OrderEditDialog, { order: order({ acquisitionMethod: "gift" }), open: true, onClose: () => {} }));
    expect(shopField()).toBeUndefined();
    await act(async () => button("Save changes").click());
    expect(updateOrder).toHaveBeenCalledWith("o1", expect.objectContaining({ venueId: null }));
  });
});

describe("the hunt and the edition of an order", () => {
  const target = (editionId: string | null) => ({
    target: { id: "t1", editionId }, state: "wanted", publisher: null,
    edition: editionId ? edition : null,
  });

  it("asks only for the edition when the book has no hunt", async () => {
    await mount(createElement(OrderTargetFields, { workId: "w1", value: { acquisitionTargetId: "", editionId: "" }, onChange: () => {} }));
    expect(labels()).toEqual(["Edition"]);
  });

  it("names a hunt as a hunt, and a hunt for one edition names it once", async () => {
    options.value = { targets: [target("e1")], editions: [edition], matches: [{ targetId: "t1", editionId: "e1" }] };
    await mount(createElement(OrderTargetFields, { workId: "w1", value: { acquisitionTargetId: "t1", editionId: "e1" }, onChange: () => {} }));
    expect(labels()).toEqual(["Hunting for"]);
  });

  it("asks for the edition of a hunt for any edition", async () => {
    options.value = { targets: [target(null)], editions: [edition], matches: [{ targetId: "t1", editionId: "e1" }] };
    await mount(createElement(OrderTargetFields, { workId: "w1", value: { acquisitionTargetId: "t1", editionId: "" }, onChange: () => {} }));
    expect(labels()).toEqual(["Hunting for", "Edition"]);
  });
});
