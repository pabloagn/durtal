"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import Image from "next/image";
import { Package, Truck, Wallet, CalendarDays, ChevronRight } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { todayLocal } from "@/lib/utils/date";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { BOOK_IN_HAND_STATUSES, getValidTransitions, orderStatusLabel, type OrderStatus } from "@/lib/constants/orders";
import { formatMoney } from "@/lib/utils/money";
import { DEFAULT_CURRENCY } from "@/lib/constants/currencies";
import { SectionHeading } from "@/components/shared/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderDetailPanel } from "./order-detail-panel";
import {
  PIPELINE_COLUMNS,
  STATUS_BADGE_VARIANT,
  METHOD_LABELS,
  STATUS_LABELS,
  getPosterUrl,
  getPosterStyle,
  getAuthorName,
  formatDate,
  formatSpend,
  type OrderItem,
  type ProvenanceStats,
} from "./order-model";
import { StatCard, PipelineOrderCard, PipelineColumn } from "./pipeline";
import { updateOrderStatus } from "@/lib/actions/catalogue-client";

export type { OrderItem, ProvenanceStats } from "./order-model";

/** From lg the order's panel stands beside the board; under it, as a sheet over the board */
const WIDE = "(min-width: 1024px)";
const onWideChange = (change: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};

/** Focus an order's card on the board or in a list, by its id */
const orderCard = (id: string) => document.querySelector<HTMLElement>(`[data-order-card="${CSS.escape(id)}"]`);

interface ProvenanceShellProps {
  activeOrders: OrderItem[];
  stats: ProvenanceStats;
}

export function ProvenanceShell({ activeOrders, stats }: ProvenanceShellProps) {
  const router = useRouter();
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);
  const [draggedOrder, setDraggedOrder] = useState<OrderItem | null>(null);
  const [optimisticOrders, setOptimisticOrders] = useState(activeOrders);
  // A phone's or a narrow window's board is too narrow to share: the panel
  // covers it, and the board is out of reach until the panel closes (SLN-1118)
  const wide = useSyncExternalStore(onWideChange, () => window.matchMedia(WIDE).matches, () => true);
  const sheet = selectedOrder !== null && !wide;

  // Where the focus goes once the panel has gone and the board is no longer
  // inert: focused sooner, a card under a sheet refuses it
  const refocus = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    if (selectedOrder || !refocus.current) return;
    refocus.current()?.focus({ preventScroll: !wide });
    refocus.current = null;
  }, [selectedOrder, wide]);

  // Closing the panel hands the focus back to its order's card
  function closeOrder() {
    const id = selectedOrder?.id;
    if (id) refocus.current = () => orderCard(id);
    setSelectedOrder(null);
  }

  // A deleted order's card goes: the focus moves to the next card, else the
  // one before, else New order (SLN-1118); it fell to the page body
  function orderDeleted() {
    const id = selectedOrder?.id;
    const cards = [...document.querySelectorAll<HTMLElement>("[data-order-card]")];
    const at = cards.findIndex((card) => card.dataset.orderCard === id);
    const next = cards[at + 1] ?? cards[at - 1];
    refocus.current = () => next ?? document.querySelector<HTMLElement>('[data-focus-empty="orders"]');
    setSelectedOrder(null);
  }

  // Sync optimistic state with server data
  useEffect(() => {
    setOptimisticOrders(activeOrders);
    // Keep selected order in sync with fresh server data
    setSelectedOrder((prev) => {
      if (!prev) return null;
      return activeOrders.find((o) => o.id === prev.id) ?? null;
    });
  }, [activeOrders]);

  // ?order= opens that order, as New order's "Open the existing order" links
  // it (SLN-1119); the address drops it, so a reload shows the board
  const asked = useSearchParams().get("order");
  useEffect(() => {
    if (!asked) return;
    const order = activeOrders.find((o) => o.id === asked);
    if (order) setSelectedOrder(order);
    const url = new URL(window.location.href);
    url.searchParams.delete("order");
    window.history.replaceState(null, "", url);
  }, [asked, activeOrders]);

  // Drag-and-drop sensors with activation delay to differentiate clicks from drags
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    const order = event.active.data.current?.order as OrderItem | undefined;
    if (order) setDraggedOrder(order);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedOrder(null);

    const { active, over } = event;
    if (!over) return;

    const order = active.data.current?.order as OrderItem | undefined;
    const targetStatus = over.data.current?.status as OrderStatus | undefined;
    if (!order || !targetStatus || targetStatus === order.status) return;

    // Validate transition
    const valid = getValidTransitions(order.status, order.acquisitionMethod);
    if (!valid.includes(targetStatus)) return;

    // Optimistic update — include date fields that the server auto-populates
    const today = todayLocal();
    const optimisticDates: Partial<OrderItem> = {};
    if (targetStatus === "shipped" || targetStatus === "in_transit") {
      optimisticDates.shippedDate = order.shippedDate ?? today;
    }
    if (BOOK_IN_HAND_STATUSES.includes(targetStatus)) {
      optimisticDates.actualDeliveryDate = order.actualDeliveryDate ?? today;
    }

    const optimisticOrder = {
      ...order,
      status: targetStatus,
      ...optimisticDates,
    };

    setOptimisticOrders((prev) =>
      prev.map((o) => (o.id === order.id ? optimisticOrder : o)),
    );

    // Keep detail panel in sync if this order is selected
    setSelectedOrder((prev) =>
      prev?.id === order.id ? optimisticOrder : prev,
    );

    // Server update
    updateOrderStatus(order.id, targetStatus)
      .then(() => {
        toast.success(
          `${order.work.title} moved to ${STATUS_LABELS[targetStatus] ?? targetStatus}`,
        );
        router.refresh();
      })
      .catch((err) => {
        // Revert optimistic update
        setOptimisticOrders((prev) =>
          prev.map((o) => (o.id === order.id ? order : o)),
        );
        setSelectedOrder((prev) => (prev?.id === order.id ? order : prev));
        toast.error(
          err instanceof Error ? err.message : "Failed to update status",
        );
      });
  }

  // Group orders by status for the pipeline
  const ordersByStatus = PIPELINE_COLUMNS.reduce<Record<string, OrderItem[]>>(
    (acc, col) => {
      acc[col.status] = optimisticOrders.filter((o) => o.status === col.status);
      return acc;
    },
    {},
  );

  // Compute valid drop targets for the currently dragged order
  const dragValidTargets = draggedOrder
    ? getValidTransitions(draggedOrder.status, draggedOrder.acquisitionMethod)
    : [];

  // Immediate acquisitions (no pipeline step needed)
  const immediateOrders = optimisticOrders.filter(
    (o) =>
      o.acquisitionMethod === "in_store_purchase" ||
      o.acquisitionMethod === "gift" ||
      o.acquisitionMethod === "event_purchase",
  );

  // C3: auction orders have their own pipeline (bid/won) not in PIPELINE_COLUMNS
  const auctionOrders = optimisticOrders.filter(
    (o) => o.acquisitionMethod === "auction",
  );

  // One total per currency: the main one large, any others underneath.
  const [mainSpend, ...otherSpend] = stats.spentByCurrency;
  const totalSpentFormatted = mainSpend
    ? formatSpend(mainSpend)
    : formatMoney(0, DEFAULT_CURRENCY);
  const totalSpentSubtext =
    otherSpend.length > 0
      ? `+ ${otherSpend.map(formatSpend).join(" + ")} · all time`
      : "All time";

  // No order yet: one empty state instead of four zeros and an empty board
  if (optimisticOrders.length === 0 && stats.orderCount === 0)
    return (
      <EmptyState
        icon={Package}
        heading="h2"
        title="No orders yet"
        description="An order follows a book you buy from the shop to your shelves: placed, shipped and delivered. Start one with New order."
      />
    );

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className="min-w-0 flex-1" inert={sheet}>
        {/* KPI Stats: one column on a phone, where a total in euros is wider than half the screen */}
        <div className="mb-8 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:grid-cols-4">
          <StatCard
            icon={Truck}
            label="In transit"
            value={stats.inTransit}
            subtext="Shipped, not yet here"
            accentColor={stats.inTransit > 0 ? "text-accent-sage" : undefined}
          />
          <StatCard
            icon={CalendarDays}
            label="Arriving this week"
            value={stats.arrivingThisWeek}
            subtext="In the next 7 days"
            accentColor={
              stats.arrivingThisWeek > 0 ? "text-accent-gold" : undefined
            }
          />
          <StatCard
            icon={Package}
            label="Active orders"
            value={stats.activeOrders}
            subtext="Not yet delivered"
          />
          <StatCard
            icon={Wallet}
            label="Total spent"
            value={totalSpentFormatted}
            subtext={totalSpentSubtext}
          />
        </div>

        {/* Pipeline board */}
        <SectionHeading title="Orders in progress" />

        <DndContext
          // A fixed id: the server and the browser make the same aria ids
          id="provenance-pipeline"
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* One status a row, its orders side by side: nothing is ever cut at
              the page's edge, as a sideways board of seven columns was */}
          <div className="pb-4">
            <div className="grid gap-3 pt-3" data-pipeline="">
              {PIPELINE_COLUMNS.map((col) => (
                <PipelineColumn
                  key={col.status}
                  status={col.status}
                  label={col.label}
                  orders={ordersByStatus[col.status] ?? []}
                  onCardClick={setSelectedOrder}
                  isDropTarget={dragValidTargets.includes(col.status)}
                />
              ))}
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {draggedOrder && (
              <div className="w-[180px]">
                <PipelineOrderCard
                  order={draggedOrder}
                  onClick={() => {}}
                  isDragOverlay
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {/* Immediate acquisitions (in-store / gifts) */}
        {immediateOrders.length > 0 && (
          <div className="mt-8">
            <SectionHeading title="Immediate acquisitions" />
            <div className="space-y-2">
              {immediateOrders.map((order) => {
                const posterUrl = getPosterUrl(order.work);
                const authorName = getAuthorName(order.work);
                return (
                  <button
                    key={order.id}
                    type="button"
                    data-order-card={order.id}
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
                          style={getPosterStyle(order.work)}
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          {/* Decoration: the title is in the text beside it */}
                          <span aria-hidden="true" data-decorative className="font-serif text-xs text-fg-muted/30">
                            {order.work.title?.[0] ?? "?"}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg-primary">
                        {order.work.title}
                      </p>
                      <p className="truncate text-xs text-fg-secondary">
                        {authorName}
                      </p>
                    </div>
                    <Badge variant={STATUS_BADGE_VARIANT[order.status]}>
                      {orderStatusLabel(order.status)}
                    </Badge>
                    <Badge variant="muted">
                      {METHOD_LABELS[order.acquisitionMethod]}
                    </Badge>
                    <span className="font-mono text-micro text-fg-secondary">
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

        {/* C3: Auction orders section */}
        {auctionOrders.length > 0 && (
          <div className="mt-8">
            <SectionHeading title="Auctions" />
            <div className="space-y-2">
              {auctionOrders.map((order) => {
                const posterUrl = getPosterUrl(order.work);
                const authorName = getAuthorName(order.work);
                return (
                  <button
                    key={order.id}
                    type="button"
                    data-order-card={order.id}
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
                          style={getPosterStyle(order.work)}
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          {/* Decoration: the title is in the text beside it */}
                          <span aria-hidden="true" data-decorative className="font-serif text-xs text-fg-muted/30">
                            {order.work.title?.[0] ?? "?"}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg-primary">
                        {order.work.title}
                      </p>
                      <p className="truncate text-xs text-fg-secondary">
                        {authorName}
                      </p>
                    </div>
                    <Badge variant={STATUS_BADGE_VARIANT[order.status]}>
                      {orderStatusLabel(order.status)}
                    </Badge>
                    <Badge variant="muted">Auction</Badge>
                    <span className="font-mono text-micro text-fg-secondary">
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

        {optimisticOrders.length === 0 && (
          <div className="mt-12 flex flex-col items-center justify-center text-center">
            <Package
              aria-hidden="true"
              data-decorative=""
              className="mb-4 h-10 w-10 text-fg-muted/30"
              strokeWidth={1}
            />
            <p className="type-item-title">No active orders</p>
          </div>
        )}
      </div>

      {/* Detail panel: beside the board from lg; under it, a sheet over the
          board below the phone's bar, where beside it the board was 8px wide
          at 390 and the panel ran past the screen at 320 (SLN-1118) */}
      {selectedOrder &&
        (wide ? (
          <div className="sticky top-6 h-[calc(100vh-6rem)] w-80 shrink-0 overflow-hidden rounded-sm border border-glass-border bg-bg-secondary shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
            <OrderDetailPanel order={selectedOrder} onClose={closeOrder} onDeleted={orderDeleted} />
          </div>
        ) : (
          <div className="glass fixed inset-x-0 bottom-0 top-12 z-30 overflow-hidden rounded-none! md:left-(--sidebar-w) md:top-0" data-order-sheet="">
            <OrderDetailPanel order={selectedOrder} onClose={closeOrder} onDeleted={orderDeleted} takeFocus />
          </div>
        ))}
    </div>
  );
}
