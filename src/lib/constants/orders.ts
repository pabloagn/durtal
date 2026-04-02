// ── Order Types and Constants ─────────────────────────────────────────────────
// Extracted from actions/orders.ts because "use server" files
// can only export async functions.

export type OrderStatus =
  | "placed"
  | "confirmed"
  | "processing"
  | "shipped"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "purchased"
  | "received"
  | "bid"
  | "won"
  | "cancelled"
  | "returned";

export type AcquisitionMethod =
  | "online_order"
  | "in_store_purchase"
  | "gift"
  | "digital_purchase"
  | "auction"
  | "event_purchase";

// C4: removed "won" — auction orders must advance past won to shipped/delivered
export const TERMINAL_STATUSES: OrderStatus[] = [
  "delivered",
  "purchased",
  "received",
  "cancelled",
  "returned",
];

export const IN_TRANSIT_STATUSES: OrderStatus[] = [
  "shipped",
  "in_transit",
  "out_for_delivery",
];

export const PIPELINE_STATUSES: OrderStatus[] = [
  "placed",
  "confirmed",
  "processing",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
];

export const AUCTION_PIPELINE: OrderStatus[] = [
  "bid",
  "won",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
];

export const IMMEDIATE_PIPELINE: OrderStatus[] = ["purchased", "received"];

export const BOOK_IN_HAND_STATUSES: OrderStatus[] = [
  "delivered",
  "purchased",
  "received",
];

// C5: shared transition validation — used by both UI and server
export function getValidTransitions(
  currentStatus: OrderStatus,
  method: AcquisitionMethod,
): OrderStatus[] {
  if ((TERMINAL_STATUSES as string[]).includes(currentStatus)) return [];

  let pipeline: OrderStatus[];
  if (method === "auction") {
    pipeline = [...AUCTION_PIPELINE];
  } else if (
    method === "in_store_purchase" ||
    method === "gift" ||
    method === "event_purchase"
  ) {
    pipeline = [...IMMEDIATE_PIPELINE];
  } else {
    pipeline = [...PIPELINE_STATUSES];
  }

  const currentIdx = pipeline.indexOf(currentStatus);
  // Allow both forward and backward transitions within the pipeline
  const reachable =
    currentIdx >= 0
      ? pipeline.filter((_, i) => i !== currentIdx)
      : pipeline;

  return [...reachable, "cancelled" as OrderStatus, "returned" as OrderStatus].filter(
    (s) => s !== currentStatus,
  );
}

// H2: valid initial statuses for a given acquisition method
export function getValidInitialStatuses(
  method: AcquisitionMethod,
): OrderStatus[] {
  switch (method) {
    case "auction":
      return ["bid", "won"];
    case "in_store_purchase":
    case "event_purchase":
      return ["purchased"];
    case "gift":
      return ["received"];
    case "online_order":
    case "digital_purchase":
    default:
      return ["placed", "confirmed", "processing", "shipped"];
  }
}

export interface CreateOrderInput {
  workId: string;
  editionId?: string | null;
  instanceId?: string | null;
  venueId?: string | null;
  acquisitionMethod: AcquisitionMethod;
  status?: OrderStatus;
  orderDate: string;
  orderConfirmation?: string | null;
  orderUrl?: string | null;
  price?: string | null;
  shippingCost?: string | null;
  totalCost?: string | null;
  currency?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shippedDate?: string | null;
  estimatedDeliveryDate?: string | null;
  actualDeliveryDate?: string | null;
  originDescription?: string | null;
  originPlaceId?: string | null;
  destinationLocationId?: string | null;
  destinationSubLocationId?: string | null;
  notes?: string | null;
}

export interface UpdateOrderInput extends Partial<CreateOrderInput> {}
