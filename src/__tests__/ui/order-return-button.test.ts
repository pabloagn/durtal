// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

const calls = vi.hoisted(() => ({ status: [] as unknown[][], refresh: 0, toasts: [] as string[], refuse: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => void calls.refresh++ }) }));
vi.mock("@/lib/actions/catalogue-client", () => ({
  updateOrderStatus: async (...args: unknown[]) => {
    calls.status.push(args);
    if (calls.refuse) throw new Error("Invalid transition");
  },
}));
vi.mock("@/lib/actions/refusal", () => ({ refusalMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("@/lib/notifications/toast", () => ({
  toast: { success: (m: string) => calls.toasts.push(m), error: (m: string) => calls.toasts.push(m) },
}));
vi.mock("@/app/(catalogue)/library/[slug]/work-metadata-grid", () => ({ WorkDetails: () => null }));
vi.mock("@/app/(catalogue)/library/[slug]/work-taxonomy-section", () => ({ WorkTaxonomySection: () => null }));

const { WorkRecord } = await import("@/app/(catalogue)/library/[slug]/work-record");
const { OrderReturnButton } = await import("@/app/(catalogue)/library/[slug]/order-return-button");

// SLN-1507: a book whose order is Delivered can't be deleted until the order
// is Returned, and an order in hand has left the pipeline, so its row on the
// book page records the return.
type Props = Parameters<typeof WorkRecord>[0];
const order = (id: string, status: string) =>
  ({
    id,
    status,
    orderDate: "2026-10-03T12:00:00",
    acquisitionMethod: "online_order",
    venue: { id: "v", name: "Shakespeare and Company", slug: "shakespeare-and-company", type: "bookshop" },
    statusHistory: [],
  }) as unknown as Props["orders"][number];

function rows(statuses: string[]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(WorkRecord, {
      work: { metadataSource: null } as unknown as Props["work"],
      orders: statuses.map((s, i) => order(`o${i}`, s)),
      media: { posters: 0, backgrounds: 0, gallery: 0 },
      links: [],
    }),
  );
  return [...host.querySelectorAll("li")];
}

async function press() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(OrderReturnButton, { orderId: "o1", order: "Delivered order" })));
  await act(async () => host.querySelector("button")!.click());
  await act(async () => root.unmount());
  host.remove();
}

describe("an order with the book in hand can be returned from the book page", () => {
  it("offers Record return on delivered, purchased and received orders only, named by its order", () => {
    const buttons = rows(["delivered", "purchased", "received", "shipped", "returned", "cancelled"]).map(
      (li) => li.querySelector("button")?.getAttribute("aria-label") ?? null,
    );
    expect(buttons.slice(3)).toEqual([null, null, null]);
    expect(buttons[0]).toMatch(/^Record return: Delivered order, Shakespeare and Company, Oct 3, 2026$/);
    expect(buttons[1]).toMatch(/^Record return: Purchased order, /);
    expect(buttons[2]).toMatch(/^Record return: Received order, /);
  });

  it("keeps the order's source beside it, and never wraps", () => {
    const [li] = rows(["delivered"]);
    expect(li.textContent).toContain("Shakespeare and Company");
    expect(li.querySelector("button")?.className.split(" ")).toEqual(
      expect.arrayContaining(["shrink-0", "whitespace-nowrap", "touch-hit"]),
    );
  });

  it("marks the order returned and refreshes the page", async () => {
    Object.assign(calls, { status: [], refresh: 0, toasts: [], refuse: false });
    await press();
    expect(calls.status).toEqual([["o1", "returned"]]);
    expect(calls.toasts).toEqual(["Return recorded"]);
    expect(calls.refresh).toBe(1);
  });

  it("says when the return is refused, and leaves the page as it is", async () => {
    Object.assign(calls, { status: [], refresh: 0, toasts: [], refuse: true });
    await press();
    expect(calls.toasts).toEqual(["Could not record return"]);
    expect(calls.refresh).toBe(0);
  });
});
