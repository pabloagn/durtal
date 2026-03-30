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

export const TERMINAL_STATUSES: OrderStatus[] = [
  "delivered",
  "purchased",
  "received",
  "won",
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
