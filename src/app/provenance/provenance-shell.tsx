"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Package,
  Truck,
  Clock,
  DollarSign,
  CalendarDays,
  ExternalLink,
  ChevronRight,
  X,
  MapPin,
  BookOpen,
  CheckCircle,
  Circle,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateOrderStatus } from "@/lib/actions/orders";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { OrderStatus, AcquisitionMethod } from "@/lib/constants/orders";

// ── Types ──────────────────────────────────────────────────────────────────────

interface MediaItem {
  s3Key: string;
  thumbnailS3Key: string | null;
  type: string;
  isActive: boolean;
  cropX: number | null;
  cropY: number | null;
  cropZoom: number | null;
}

interface OrderWork {
  id: string;
  title: string;
  slug: string;
  workAuthors: Array<{ author: { id: string; name: string } }>;
  media: MediaItem[];
}

interface OrderVenue {
  id: string;
  name: string;
  slug: string;
  type: string;
}

export interface OrderItem {
  id: string;
  workId: string;
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
  totalSpent: string;
  avgOrderCost: string;
  orderCount: number;
  activeOrders: number;
  inTransit: number;
  arrivingThisWeek: number;
}

interface ProvenanceShellProps {
  activeOrders: OrderItem[];
  stats: ProvenanceStats;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PIPELINE_COLUMNS: { status: OrderStatus; label: string }[] = [
  { status: "placed", label: "Placed" },
  { status: "confirmed", label: "Confirmed" },
  { status: "processing", label: "Processing" },
  { status: "shipped", label: "Shipped" },
  { status: "in_transit", label: "In Transit" },
  { status: "out_for_delivery", label: "Out for Delivery" },
  { status: "delivered", label: "Delivered" },
];

const STATUS_COLORS: Record<OrderStatus, string> = {
  placed: "text-fg-muted",
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
  cancelled: "text-accent-red",
  returned: "text-accent-red",
};

const STATUS_BG: Record<OrderStatus, string> = {
  placed: "bg-fg-muted/10",
  confirmed: "bg-accent-blue/10",
  processing: "bg-accent-gold/10",
  shipped: "bg-accent-sage/10",
  in_transit: "bg-accent-sage/10",
  out_for_delivery: "bg-accent-gold/10",
  delivered: "bg-accent-sage/10",
  purchased: "bg-accent-sage/10",
  received: "bg-accent-sage/10",
  bid: "bg-accent-gold/10",
  won: "bg-accent-sage/10",
  cancelled: "bg-accent-red/10",
  returned: "bg-accent-red/10",
};

const STATUS_BADGE_VARIANT: Record<
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

const METHOD_LABELS: Record<AcquisitionMethod, string> = {
  online_order: "Online Order",
  in_store_purchase: "In-Store",
  gift: "Gift",
  digital_purchase: "Digital",
  auction: "Auction",
  event_purchase: "Event",
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  placed: "confirmed",
  confirmed: "processing",
  processing: "shipped",
  shipped: "in_transit",
  in_transit: "out_for_delivery",
  out_for_delivery: "delivered",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPosterUrl(work: OrderWork): string | null {
  const poster = work.media.find((m) => m.type === "poster" && m.isActive);
  if (!poster) return null;
  const key = poster.thumbnailS3Key ?? poster.s3Key;
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}

function getAuthorName(work: OrderWork): string {
  return work.workAuthors[0]?.author?.name ?? "Unknown Author";
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateFull(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatCurrency(amount: string | null, currency: string | null): string {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return "—";
  const cur = currency ?? "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cur,
    }).format(num);
  } catch {
    return `${cur} ${num.toFixed(2)}`;
  }
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  accentColor,
}: {
  icon: React.FC<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string | number;
  subtext?: string;
  accentColor?: string;
}) {
  return (
    <div className="rounded-sm border border-glass-border bg-bg-secondary p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-micro text-fg-muted uppercase tracking-wider">
            {label}
          </p>
          <p
            className={`mt-1.5 font-serif text-3xl tracking-tight ${accentColor ?? "text-fg-primary"}`}
          >
            {value}
          </p>
          {subtext && (
            <p className="mt-1 text-xs text-fg-muted">{subtext}</p>
          )}
        </div>
        <div className="rounded-sm border border-glass-border bg-bg-tertiary/40 p-2">
          <Icon
            className={`h-4 w-4 ${accentColor ?? "text-fg-secondary"}`}
            strokeWidth={1.5}
          />
        </div>
      </div>
    </div>
  );
}

// ── Order Card (in pipeline column) ──────────────────────────────────────────

function PipelineOrderCard({
  order,
  onClick,
}: {
  order: OrderItem;
  onClick: (order: OrderItem) => void;
}) {
  const posterUrl = getPosterUrl(order.work);
  const authorName = getAuthorName(order.work);
  const days = daysSince(order.orderDate);

  const hasEta = Boolean(order.estimatedDeliveryDate);
  const etaDays = hasEta ? daysUntil(order.estimatedDeliveryDate!) : null;
  const etaOverdue = etaDays !== null && etaDays < 0;

  return (
    <button
      type="button"
      onClick={() => onClick(order)}
      className="w-full rounded-sm border border-glass-border bg-bg-primary/60 p-2.5 text-left transition-all duration-150 hover:border-fg-muted/15 hover:bg-bg-primary active:scale-[0.99]"
    >
      <div className="flex items-start gap-2.5">
        {/* Poster */}
        <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
          {posterUrl ? (
            <Image
              src={posterUrl}
              alt={order.work.title}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="font-serif text-xs text-fg-muted/30">
                {order.work.title[0]}
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-medium leading-snug text-fg-primary">
            {order.work.title}
          </p>
          <p className="mt-0.5 truncate font-mono text-micro text-fg-muted">
            {authorName}
          </p>
          {order.venue && (
            <p className="mt-1 truncate font-mono text-micro text-fg-muted">
              {order.venue.name}
            </p>
          )}
        </div>
      </div>

      {/* Footer badges */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <span className="font-mono text-micro text-fg-muted">
          {days === 0 ? "today" : `${days}d ago`}
        </span>

        {hasEta && (
          <span
            className={`ml-auto font-mono text-micro ${etaOverdue ? "text-accent-red" : "text-accent-gold"}`}
          >
            {etaOverdue
              ? `${Math.abs(etaDays!)}d late`
              : etaDays === 0
                ? "today"
                : `${etaDays}d`}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Pipeline Column ───────────────────────────────────────────────────────────

function PipelineColumn({
  status,
  label,
  orders,
  onCardClick,
}: {
  status: OrderStatus;
  label: string;
  orders: OrderItem[];
  onCardClick: (order: OrderItem) => void;
}) {
  const count = orders.length;
  const isActive = count > 0;

  return (
    <div
      className={`flex min-w-[160px] max-w-[200px] flex-shrink-0 flex-col rounded-sm border transition-colors ${
        isActive
          ? "border-glass-border bg-bg-secondary/60"
          : "border-glass-border/50 bg-bg-secondary/20"
      }`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between border-b border-glass-border px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${isActive ? STATUS_COLORS[status].replace("text-", "bg-") : "bg-fg-muted/30"}`}
          />
          <span className="font-mono text-micro text-fg-secondary uppercase tracking-wider">
            {label}
          </span>
        </div>
        <span
          className={`font-mono text-micro ${isActive ? "text-fg-secondary" : "text-fg-muted/50"}`}
        >
          {count}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-2 p-2">
        {orders.map((order) => (
          <PipelineOrderCard
            key={order.id}
            order={order}
            onClick={onCardClick}
          />
        ))}
        {count === 0 && (
          <div className="flex flex-1 items-center justify-center py-6">
            <span className="font-mono text-micro text-fg-muted/30">—</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Order Detail Panel ─────────────────────────────────────────────────────────

function StatusHistoryDot({
  status,
  isLast,
}: {
  status: OrderStatus;
  isLast: boolean;
}) {
  const color = STATUS_COLORS[status] ?? "text-fg-muted";
  return (
    <div className="flex flex-col items-center">
      <div
        className={`h-2 w-2 rounded-full border ${color.replace("text-", "border-")} ${STATUS_BG[status]}`}
      />
      {!isLast && (
        <div className="mt-1 h-6 w-px bg-glass-border" />
      )}
    </div>
  );
}

function OrderDetailPanel({
  order,
  onClose,
}: {
  order: OrderItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const posterUrl = getPosterUrl(order.work);
  const authorName = getAuthorName(order.work);
  const nextStatus = NEXT_STATUS[order.status];

  async function handleAdvanceStatus() {
    if (!nextStatus) return;
    setIsPending(true);
    try {
      await updateOrderStatus(order.id, nextStatus);
      toast.success(`Status updated to ${nextStatus.replace(/_/g, " ")}`);
      router.refresh();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update status",
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-glass-border px-5 py-3.5">
        <h2 className="font-serif text-lg text-fg-primary">Order Details</h2>
        <button
          onClick={onClose}
          className="rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary/50 hover:text-fg-secondary"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {/* Work info */}
        <div className="flex gap-4">
          <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary shadow-[0_4px_16px_rgba(0,0,0,0.5)]">
            {posterUrl ? (
              <Image
                src={posterUrl}
                alt={order.work.title}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="font-serif text-lg text-fg-muted/30">
                  {order.work.title[0]}
                </span>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <Link
              href={`/library/${order.work.slug}`}
              className="font-serif text-lg leading-snug text-fg-primary hover:text-accent-gold transition-colors"
            >
              {order.work.title}
            </Link>
            <p className="mt-0.5 text-sm text-fg-secondary">{authorName}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant={STATUS_BADGE_VARIANT[order.status]}>
                {order.status.replace(/_/g, " ")}
              </Badge>
              <Badge variant="muted">
                {METHOD_LABELS[order.acquisitionMethod]}
              </Badge>
            </div>
          </div>
        </div>

        {/* Order timeline */}
        <div className="mt-6">
          <h3 className="mb-3 font-mono text-micro uppercase tracking-wider text-fg-muted">
            Timeline
          </h3>
          <div className="space-y-1">
            {[
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
            ].map(({ label, date, done }) => (
              <div key={label} className="flex items-center gap-3">
                {done ? (
                  <CheckCircle
                    className="h-3.5 w-3.5 shrink-0 text-accent-sage"
                    strokeWidth={1.5}
                  />
                ) : (
                  <Circle
                    className="h-3.5 w-3.5 shrink-0 text-fg-muted/40"
                    strokeWidth={1.5}
                  />
                )}
                <span
                  className={`text-xs ${done ? "text-fg-primary" : "text-fg-muted"}`}
                >
                  {label}
                </span>
                <span className="ml-auto font-mono text-micro text-fg-muted">
                  {formatDate(date)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Shipping info */}
        {(order.carrier || order.trackingNumber) && (
          <div className="mt-6">
            <h3 className="mb-3 font-mono text-micro uppercase tracking-wider text-fg-muted">
              Shipping
            </h3>
            <div className="rounded-sm border border-glass-border bg-bg-tertiary/30 p-3 space-y-2">
              {order.carrier && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-fg-muted">Carrier</span>
                  <span className="text-xs text-fg-primary">{order.carrier}</span>
                </div>
              )}
              {order.trackingNumber && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-fg-muted">Tracking #</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-micro text-fg-primary">
                      {order.trackingNumber}
                    </span>
                    {order.trackingUrl && (
                      <a
                        href={order.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-blue hover:text-accent-blue/80"
                      >
                        <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Price breakdown */}
        {(order.price || order.totalCost) && (
          <div className="mt-6">
            <h3 className="mb-3 font-mono text-micro uppercase tracking-wider text-fg-muted">
              Cost
            </h3>
            <div className="rounded-sm border border-glass-border bg-bg-tertiary/30 p-3 space-y-2">
              {order.price && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-fg-muted">Price</span>
                  <span className="font-mono text-micro text-fg-primary">
                    {formatCurrency(order.price, order.currency)}
                  </span>
                </div>
              )}
              {order.shippingCost && parseFloat(order.shippingCost) > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-fg-muted">Shipping</span>
                  <span className="font-mono text-micro text-fg-primary">
                    {formatCurrency(order.shippingCost, order.currency)}
                  </span>
                </div>
              )}
              {order.totalCost && (
                <div className="flex items-center justify-between border-t border-glass-border pt-2">
                  <span className="text-xs font-medium text-fg-secondary">
                    Total
                  </span>
                  <span className="font-mono text-xs font-medium text-fg-primary">
                    {formatCurrency(order.totalCost, order.currency)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Venue */}
        {order.venue && (
          <div className="mt-6">
            <h3 className="mb-3 font-mono text-micro uppercase tracking-wider text-fg-muted">
              Venue
            </h3>
            <Link
              href={`/places/${order.venue.slug}`}
              className="flex items-center gap-2 rounded-sm border border-glass-border bg-bg-tertiary/30 p-3 transition-colors hover:border-fg-muted/15 hover:bg-bg-tertiary/50"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-fg-muted" strokeWidth={1.5} />
              <span className="text-xs text-fg-primary">{order.venue.name}</span>
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-fg-muted" strokeWidth={1.5} />
            </Link>
          </div>
        )}

        {/* External links */}
        <div className="mt-6 flex flex-wrap gap-2">
          {order.orderUrl && (
            <a
              href={order.orderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm border border-glass-border bg-bg-tertiary/30 px-2.5 py-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
            >
              <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
              Order Page
            </a>
          )}
          <Link
            href={`/library/${order.work.slug}`}
            className="inline-flex items-center gap-1.5 rounded-sm border border-glass-border bg-bg-tertiary/30 px-2.5 py-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
          >
            <BookOpen className="h-3 w-3" strokeWidth={1.5} />
            View Work
          </Link>
        </div>

        {/* Notes */}
        {order.notes && (
          <div className="mt-6">
            <h3 className="mb-2 font-mono text-micro uppercase tracking-wider text-fg-muted">
              Notes
            </h3>
            <p className="text-xs leading-relaxed text-fg-secondary">
              {order.notes}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      {nextStatus && (
        <div className="border-t border-glass-border p-4">
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={handleAdvanceStatus}
            disabled={isPending}
          >
            {isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            ) : (
              <>
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                Mark as {nextStatus.replace(/_/g, " ")}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main Shell ─────────────────────────────────────────────────────────────────

export function ProvenanceShell({ activeOrders, stats }: ProvenanceShellProps) {
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);

  // Group orders by status for the pipeline
  const ordersByStatus = PIPELINE_COLUMNS.reduce<Record<string, OrderItem[]>>(
    (acc, col) => {
      acc[col.status] = activeOrders.filter(
        (o) => o.status === col.status,
      );
      return acc;
    },
    {},
  );

  // Immediate acquisitions (no pipeline step needed)
  const immediateOrders = activeOrders.filter(
    (o) =>
      o.acquisitionMethod === "in_store_purchase" ||
      o.acquisitionMethod === "gift" ||
      o.acquisitionMethod === "event_purchase",
  );

  const totalSpentFormatted = stats.totalSpent
    ? (() => {
        const num = parseFloat(stats.totalSpent);
        if (isNaN(num)) return "—";
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "EUR",
          maximumFractionDigits: 0,
        }).format(num);
      })()
    : "—";

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className="min-w-0 flex-1">
        {/* KPI Stats */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={Truck}
            label="In Transit"
            value={stats.inTransit}
            subtext="shipped orders"
            accentColor={stats.inTransit > 0 ? "text-accent-sage" : undefined}
          />
          <StatCard
            icon={CalendarDays}
            label="Arriving This Week"
            value={stats.arrivingThisWeek}
            subtext="next 7 days"
            accentColor={
              stats.arrivingThisWeek > 0 ? "text-accent-gold" : undefined
            }
          />
          <StatCard
            icon={Package}
            label="Active Orders"
            value={stats.activeOrders}
            subtext="non-terminal"
          />
          <StatCard
            icon={DollarSign}
            label="Total Spent"
            value={totalSpentFormatted}
            subtext="all time"
          />
        </div>

        {/* Pipeline board */}
        <div className="mb-2">
          <h2 className="font-serif text-2xl tracking-tight text-fg-primary">
            Active Pipeline
          </h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Orders in transit, by status
          </p>
        </div>

        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-max gap-3 pt-3">
            {PIPELINE_COLUMNS.map((col) => (
              <PipelineColumn
                key={col.status}
                status={col.status}
                label={col.label}
                orders={ordersByStatus[col.status] ?? []}
                onCardClick={setSelectedOrder}
              />
            ))}
          </div>
        </div>

        {/* Immediate acquisitions (in-store / gifts) */}
        {immediateOrders.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 font-serif text-xl tracking-tight text-fg-primary">
              Immediate Acquisitions
            </h2>
            <div className="space-y-2">
              {immediateOrders.map((order) => {
                const posterUrl = getPosterUrl(order.work);
                const authorName = getAuthorName(order.work);
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setSelectedOrder(order)}
                    className="flex w-full items-center gap-3 rounded-sm border border-glass-border bg-bg-secondary/60 px-4 py-3 text-left transition-all hover:border-fg-muted/15 hover:bg-bg-secondary"
                  >
                    <div className="relative h-10 w-7 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
                      {posterUrl ? (
                        <Image
                          src={posterUrl}
                          alt={order.work.title}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <span className="font-serif text-xs text-fg-muted/30">
                            {order.work.title[0]}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg-primary">
                        {order.work.title}
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {authorName}
                      </p>
                    </div>
                    <Badge variant={STATUS_BADGE_VARIANT[order.status]}>
                      {order.status.replace(/_/g, " ")}
                    </Badge>
                    <Badge variant="muted">
                      {METHOD_LABELS[order.acquisitionMethod]}
                    </Badge>
                    <span className="font-mono text-micro text-fg-muted">
                      {formatDate(order.orderDate)}
                    </span>
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-fg-muted"
                      strokeWidth={1.5}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeOrders.length === 0 && (
          <div className="mt-12 flex flex-col items-center justify-center text-center">
            <Package
              className="mb-4 h-10 w-10 text-fg-muted/30"
              strokeWidth={1}
            />
            <p className="font-serif text-xl text-fg-secondary">
              No active orders
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              Create a new order to start tracking provenance
            </p>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedOrder && (
        <div className="sticky top-6 h-[calc(100vh-6rem)] w-80 shrink-0 overflow-hidden rounded-sm border border-glass-border bg-bg-secondary shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <OrderDetailPanel
            order={selectedOrder}
            onClose={() => setSelectedOrder(null)}
          />
        </div>
      )}
    </div>
  );
}
