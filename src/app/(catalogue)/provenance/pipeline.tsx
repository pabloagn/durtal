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
      data-order-card={isDragOverlay ? undefined : order.id}
      onClick={() => onClick(order)}
      {...listeners}
      {...attributes}
      className={`flex w-full flex-col rounded-sm border border-glass-border bg-bg-primary/60 p-2.5 text-left transition-all duration-150 hover:border-fg-muted/15 hover:bg-bg-primary active:scale-[0.99] ${
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
          <p className="text-xs font-medium leading-snug [overflow-wrap:break-word] text-fg-primary">
            {order.work.title}
          </p>
          <p className="mt-0.5 font-mono text-micro [overflow-wrap:break-word] text-fg-secondary">
            {authorName}
          </p>
          {order.venue && (
            <p className="mt-1 font-mono text-micro [overflow-wrap:break-word] text-fg-secondary">
              {order.venue.name}
            </p>
          )}
        </div>
      </div>

      {/* Footer badges: at the card's foot, so a row's cards, stretched to its
          tallest, start their titles and end their footers on one line */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
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
      data-pipeline-column={status}
      className={`min-w-0 rounded-sm border transition-colors ${
        isOver && isDropTarget
          ? "border-accent-primary/50 bg-accent-primary/5"
          : isActive
            ? "border-glass-border bg-bg-secondary/60"
            : "border-glass-border/50 bg-bg-secondary/20"
      }`}
    >
      {/* Status header: the label wraps whole words; the dot sits on its first line */}
      <div className={`type-caption flex items-start justify-between gap-2 px-3 py-2.5 ${isActive ? "border-b border-glass-border" : ""}`}>
        <div className="flex min-w-0 items-start gap-1.5">
          <CapAligned height={6}>
            <span
              className={`block h-1.5 w-1.5 rounded-full ${isActive ? STATUS_COLORS[status].replace("text-", "bg-") : "bg-fg-muted/30"}`}
            />
          </CapAligned>
          <span className="min-w-0">{label}</span>
        </div>
        <span className={isActive ? "text-fg-primary" : "text-fg-secondary"}>
          {count}
        </span>
      </div>

      {/* Its orders side by side, as many a row as fit; an empty status is its header alone */}
      {count > 0 && (
        <div className="grid gap-2 p-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,13rem),1fr))]">
          {orders.map((order) => (
            <PipelineOrderCard
              key={order.id}
              order={order}
              onClick={onCardClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
