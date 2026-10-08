"use client";

import Image from "next/image";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import type { OrderStatus } from "@/lib/constants/orders";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  STATUS_COLORS,
  getPosterUrl,
  getPosterStyle,
  getAuthorName,
  daysSince,
  daysUntil,
  type OrderItem,
} from "./order-model";

// The provenance pipeline: summary cards, order cards and the status columns they move between.

export function StatCard({
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
          <p className="type-caption">
            {label}
          </p>
          <p
            className={`type-stat mt-1.5 ${accentColor ?? "text-fg-primary"}`}
          >
            {value}
          </p>
          {subtext && <p className="mt-1 text-xs text-fg-secondary">{subtext}</p>}
        </div>
        {/* Carries the label's type: the icon sits on its cap-height center */}
        <CapAligned height={16} className="type-caption">
          <Icon
            className={`block h-4 w-4 ${accentColor ?? "text-fg-secondary"}`}
            strokeWidth={1.5}
          />
        </CapAligned>
      </div>
    </div>
  );
}

export function PipelineOrderCard({
  order,
  onClick,
  isDragOverlay,
}: {
  order: OrderItem;
  onClick: (order: OrderItem) => void;
  isDragOverlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: order.id,
    data: { order },
  });

  const posterUrl = getPosterUrl(order.work);
  const authorName = getAuthorName(order.work);
  const days = daysSince(order.orderDate);

  const hasEta = Boolean(order.estimatedDeliveryDate);
  const etaDays = hasEta ? daysUntil(order.estimatedDeliveryDate!) : null;
  const etaOverdue = etaDays !== null && etaDays < 0;

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onClick(order)}
      {...listeners}
      {...attributes}
      className={`w-full rounded-sm border border-glass-border bg-bg-primary/60 p-2.5 text-left transition-all duration-150 hover:border-fg-muted/15 hover:bg-bg-primary active:scale-[0.99] ${
        isDragging && !isDragOverlay ? "opacity-30" : ""
      } ${isDragOverlay ? "shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-accent-primary/40" : ""}`}
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

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-medium leading-snug text-fg-primary">
            {order.work.title}
          </p>
          <p className="mt-0.5 truncate font-mono text-micro text-fg-secondary">
            {authorName}
          </p>
          {order.venue && (
            <p className="mt-1 truncate font-mono text-micro text-fg-secondary">
              {order.venue.name}
            </p>
          )}
        </div>
      </div>

      {/* Footer badges */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <span className="font-mono text-micro text-fg-secondary">
          {days === 0 ? "today" : `${days}d ago`}
        </span>

        {hasEta && (
          <span
            className={`ml-auto font-mono text-micro ${etaOverdue ? "text-accent-red-text" : "text-accent-gold"}`}
          >
            {etaOverdue
              ? `${Math.abs(etaDays ?? 0)}d late`
              : etaDays === 0
                ? "today"
                : `${etaDays}d`}
          </span>
        )}
      </div>
    </button>
  );
}

export function PipelineColumn({
  status,
  label,
  orders,
  onCardClick,
  isDropTarget,
}: {
  status: OrderStatus;
  label: string;
  orders: OrderItem[];
  onCardClick: (order: OrderItem) => void;
  isDropTarget?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { status },
  });

  const count = orders.length;
  const isActive = count > 0;

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[160px] max-w-[200px] flex-shrink-0 flex-col rounded-sm border transition-colors ${
        isOver && isDropTarget
          ? "border-accent-primary/50 bg-accent-primary/5"
          : isActive
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
          <span className="type-caption">
            {label}
          </span>
        </div>
        <span
          className={`font-mono text-micro ${isActive ? "text-fg-primary" : "text-fg-secondary"}`}
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
            <span className="font-mono text-micro text-fg-secondary">—</span>
          </div>
        )}
      </div>
    </div>
  );
}
