import type { OrderStatus, AcquisitionMethod } from "@/lib/constants/orders";
import { AUCTION_PIPELINE } from "@/lib/constants/orders";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";
import { formatMoney, type CurrencyTotal } from "@/lib/utils/money";

// Orders on the provenance page: their shape, status words and colours, and small helpers. Pure module.

export interface MediaItem {
  s3Key: string;
  thumbnailS3Key: string | null;
  type: string;
  isActive: boolean;
  cropX: number | null;
  cropY: number | null;
  cropZoom: number | null;
  brightness: number | null;
  contrast: number | null;
}

export interface OrderWork {
  id: string;
  title: string;
  slug: string;
  kind?: string | null;
  workAuthors: Array<{ author: { id: string; name: string } }>;
  media: MediaItem[];
}

export interface OrderVenue {
  id: string;
  name: string;
  slug: string;
  type: string;
}

export interface OrderItem {
  id: string;
  workId: string;
  editionId?: string | null;
  acquisitionTargetId?: string | null;
  work: OrderWork;
  venue: OrderVenue | null;
  acquisitionMethod: AcquisitionMethod;
  status: OrderStatus;
  orderDate: string;
  estimatedDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  shippedDate: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  orderUrl: string | null;
  orderConfirmation: string | null;
  price: string | null;
  shippingCost: string | null;
  totalCost: string | null;
  currency: string | null;
  notes: string | null;
  createdAt: Date | string;
}

export interface ProvenanceStats {
  spentByCurrency: CurrencyTotal[];
  avgOrderCost: string;
  orderCount: number;
  activeOrders: number;
  inTransit: number;
  arrivingThisWeek: number;
}

export const PIPELINE_COLUMNS: { status: OrderStatus; label: string }[] = [
  { status: "placed", label: "Placed" },
  { status: "confirmed", label: "Confirmed" },
  { status: "processing", label: "Processing" },
  { status: "shipped", label: "Shipped" },
  { status: "in_transit", label: "In Transit" },
  { status: "out_for_delivery", label: "Out for Delivery" },
  { status: "delivered", label: "Delivered" },
];

export const STATUS_COLORS: Record<OrderStatus, string> = {
  placed: "text-fg-secondary",
  confirmed: "text-accent-blue",
  processing: "text-accent-gold",
  shipped: "text-accent-sage",
  in_transit: "text-accent-sage",
  out_for_delivery: "text-accent-gold",
  delivered: "text-accent-sage",
  purchased: "text-accent-sage",
  received: "text-accent-sage",
  bid: "text-accent-gold",
  won: "text-accent-sage",
  cancelled: "text-accent-red-text",
  returned: "text-accent-red-text",
};

export const STATUS_BADGE_VARIANT: Record<
  OrderStatus,
  "default" | "blue" | "gold" | "sage" | "red" | "muted"
> = {
  placed: "muted",
  confirmed: "blue",
  processing: "gold",
  shipped: "sage",
  in_transit: "sage",
  out_for_delivery: "gold",
  delivered: "sage",
  purchased: "sage",
  received: "sage",
  bid: "gold",
  won: "sage",
  cancelled: "red",
  returned: "red",
};

export const METHOD_LABELS: Record<AcquisitionMethod, string> = {
  online_order: "Online Order",
  in_store_purchase: "In-Store",
  gift: "Gift",
  digital_purchase: "Digital",
  auction: "Auction",
  event_purchase: "Event",
};

export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  placed: "confirmed",
  confirmed: "processing",
  processing: "shipped",
  shipped: "in_transit",
  in_transit: "out_for_delivery",
  out_for_delivery: "delivered",
  bid: "won",
  won: "shipped",
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  placed: "Placed",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  purchased: "Purchased",
  received: "Received",
  bid: "Bid",
  won: "Won",
  cancelled: "Cancelled",
  returned: "Returned",
};

export function getPosterUrl(work: OrderWork): string | null {
  const poster = work.media.find((m) => m.type === "poster" && m.isActive);
  if (!poster) return null;
  const key = poster.thumbnailS3Key ?? poster.s3Key;
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}

/** Crop and brightness/contrast of the work's active poster */
export function getPosterStyle(work: OrderWork) {
  const poster = work.media.find((m) => m.type === "poster" && m.isActive);
  return poster ? mediaImageStyle(mediaCrop(poster)) : undefined;
}

export function getAuthorName(work: OrderWork): string {
  return work.workAuthors[0]?.author?.name ?? "Unknown Author";
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// M1: method-aware timeline steps
export function getTimelineSteps(
  order: OrderItem,
): { label: string; date: string | null; done: boolean }[] {
  const m = order.acquisitionMethod;
  if (m === "gift") {
    return [
      {
        label: "Received",
        date: order.actualDeliveryDate,
        done: Boolean(order.actualDeliveryDate),
      },
    ];
  }
  if (m === "in_store_purchase" || m === "event_purchase") {
    return [{ label: "Purchased", date: order.orderDate, done: true }];
  }
  if (m === "auction") {
    return [
      { label: "Bid placed", date: order.orderDate, done: true },
      {
        label: "Won",
        date: null,
        done:
          AUCTION_PIPELINE.indexOf(order.status) >=
          AUCTION_PIPELINE.indexOf("won"),
      },
      {
        label: "Shipped",
        date: order.shippedDate,
        done: Boolean(order.shippedDate),
      },
      {
        label: "Delivered",
        date: order.actualDeliveryDate,
        done: Boolean(order.actualDeliveryDate),
      },
    ];
  }
  // online_order / digital_purchase
  return [
    { label: "Order placed", date: order.orderDate, done: true },
    {
      label: "Shipped",
      date: order.shippedDate,
      done: Boolean(order.shippedDate),
    },
    {
      label: "Estimated delivery",
      date: order.estimatedDeliveryDate,
      done: Boolean(order.actualDeliveryDate),
    },
    {
      label: "Delivered",
      date: order.actualDeliveryDate,
      done: Boolean(order.actualDeliveryDate),
    },
  ];
}

export function formatSpend({ currency, total }: CurrencyTotal): string {
  const amount = formatMoney(total, currency);
  return currency ? amount : `${amount} (no currency)`;
}
