"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { workHref } from "@/lib/catalogue/work-href";
import {
  ExternalLink,
  ChevronRight,
  ChevronDown,
  X,
  MapPin,
  BookOpen,
  CheckCircle,
  Circle,
  RefreshCw,
  Pencil,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CapAligned } from "@/components/shared/cap-aligned";
import { updateOrderStatus, deleteOrder } from "@/lib/actions/orders";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { OrderStatus } from "@/lib/constants/orders";
import { getValidTransitions, orderStatusLabel } from "@/lib/constants/orders";
import { OrderEditDialog } from "./order-edit-dialog";
import { formatMoney } from "@/lib/utils/money";
import {
  STATUS_COLORS,
  STATUS_BADGE_VARIANT,
  METHOD_LABELS,
  NEXT_STATUS,
  STATUS_LABELS,
  getPosterUrl,
  getPosterStyle,
  getAuthorName,
  formatDate,
  getTimelineSteps,
  type OrderItem,
} from "./order-model";

// The panel of one order: its book, timeline, costs, tracking and actions.

export function OrderDetailPanel({
  order,
  onClose,
}: {
  order: OrderItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const posterUrl = getPosterUrl(order.work);
  const authorName = getAuthorName(order.work);

  const validTransitions = getValidTransitions(
    order.status,
    order.acquisitionMethod,
  );
  const nextStatus = NEXT_STATUS[order.status];

  // Close status dropdown on outside click
  useEffect(() => {
    if (!statusDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        statusDropdownRef.current &&
        !statusDropdownRef.current.contains(e.target as Node)
      ) {
        setStatusDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [statusDropdownOpen]);

  async function handleStatusChange(newStatus: OrderStatus) {
    setStatusDropdownOpen(false);
    setIsPending(true);
    try {
      await updateOrderStatus(order.id, newStatus);
      toast.success(`Status updated to ${orderStatusLabel(newStatus)}`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update status",
      );
    } finally {
      setIsPending(false);
    }
  }

  async function handleDelete() {
    setIsPending(true);
    try {
      await deleteOrder(order.id);
      toast.success("Order deleted");
      router.refresh();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete order",
      );
    } finally {
      setIsPending(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <div className="flex h-full flex-col">
        {/* Panel header */}
        <div className="flex items-start justify-between border-b border-glass-border px-5 py-3.5">
          <h2 className="type-item-title">Order Details</h2>
          {/* Carries the title's type: the buttons sit on its cap-height center, 44px high on touch */}
          <CapAligned height={24} coarseHeight={44} className="type-item-title">
            <div className="flex h-full items-center gap-1">
              <button
                onClick={() => setShowEditDialog(true)}
                aria-label="Edit order"
                data-tooltip="Edit order"
                className="rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary/50 hover:text-fg-secondary pointer-coarse:p-[15px]"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete order"
                data-tooltip="Delete order"
                className="rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary/50 hover:text-accent-red pointer-coarse:p-[15px]"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              <button
                aria-label="Close"
                data-tooltip="Close"
                onClick={onClose}
                className="rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary/50 hover:text-fg-secondary pointer-coarse:p-3.5"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </CapAligned>
        </div>

        {/* Delete confirmation */}
        {confirmDelete && (
          <div className="border-b border-accent-red/30 bg-accent-red/5 px-5 py-3">
            <p className="text-xs text-fg-secondary">
              Delete this order? This cannot be undone.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={handleDelete}
                disabled={isPending}
              >
                {isPending ? "Deleting..." : "Delete"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

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
                  style={getPosterStyle(order.work)}
                  unoptimized
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  {/* Decoration: the title is in the text beside it */}
                  <span aria-hidden="true" data-decorative className="font-serif text-lg text-fg-muted/30">
                    {order.work.title?.[0] ?? "?"}
                  </span>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <Link
                href={workHref(order.work)}
                className="type-item-title transition-colors hover:text-accent-gold"
              >
                {order.work.title}
              </Link>
              <p className="mt-0.5 text-sm text-fg-secondary">{authorName}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant={STATUS_BADGE_VARIANT[order.status]}>
                  {orderStatusLabel(order.status)}
                </Badge>
                <Badge variant="muted">
                  {METHOD_LABELS[order.acquisitionMethod]}
                </Badge>
              </div>
            </div>
          </div>

          {/* M1: method-aware order timeline */}
          <div className="mt-6">
            <h3 className="type-caption mb-3">
              Timeline
            </h3>
            <div className="space-y-1">
              {getTimelineSteps(order).map(({ label, date, done }) => (
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
                    className={`text-xs ${done ? "text-fg-primary" : "text-fg-secondary"}`}
                  >
                    {label}
                  </span>
                  <span className="ml-auto font-mono text-micro text-fg-secondary">
                    {formatDate(date)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Shipping info */}
          {(order.carrier || order.trackingNumber) && (
            <div className="mt-6">
              <h3 className="type-caption mb-3">
                Shipping
              </h3>
              <div className="rounded-sm border border-glass-border bg-bg-tertiary/30 p-3 space-y-2">
                {order.carrier && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg-secondary">Carrier</span>
                    <span className="text-xs text-fg-primary">
                      {order.carrier}
                    </span>
                  </div>
                )}
                {order.trackingNumber && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg-secondary">Tracking #</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-micro text-fg-primary">
                        {order.trackingNumber}
                      </span>
                      {order.trackingUrl && (
                        <a
                          aria-label="Open tracking page"
                          data-tooltip="Open tracking page"
                          href={order.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-blue hover:text-accent-blue/80 touch-hit"
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
              <h3 className="type-caption mb-3">
                Cost
              </h3>
              <div className="rounded-sm border border-glass-border bg-bg-tertiary/30 p-3 space-y-2">
                {order.price && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg-secondary">Price</span>
                    <span className="font-mono text-micro text-fg-primary">
                      {formatMoney(order.price, order.currency)}
                    </span>
                  </div>
                )}
                {order.shippingCost && parseFloat(order.shippingCost) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg-secondary">Shipping</span>
                    <span className="font-mono text-micro text-fg-primary">
                      {formatMoney(order.shippingCost, order.currency)}
                    </span>
                  </div>
                )}
                {order.totalCost && (
                  <div className="flex items-center justify-between border-t border-glass-border pt-2">
                    <span className="text-xs font-medium text-fg-secondary">
                      Total
                    </span>
                    <span className="font-mono text-xs font-medium text-fg-primary">
                      {formatMoney(order.totalCost, order.currency)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Venue */}
          {order.venue && (
            <div className="mt-6">
              <h3 className="type-caption mb-3">
                Venue
              </h3>
              <Link
                href={`/places/${order.venue.slug}`}
                className="flex items-center gap-2 rounded-sm border border-glass-border bg-bg-tertiary/30 p-3 transition-colors hover:border-fg-muted/15 hover:bg-bg-tertiary/50"
              >
                <MapPin
                  className="h-3.5 w-3.5 shrink-0 text-fg-muted"
                  strokeWidth={1.5}
                />
                <span className="text-xs text-fg-primary">
                  {order.venue.name}
                </span>
                <ChevronRight
                  className="ml-auto h-3.5 w-3.5 text-fg-muted"
                  strokeWidth={1.5}
                />
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
                className="inline-flex items-center gap-1.5 rounded-sm border border-glass-border bg-bg-tertiary/30 px-2.5 py-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
              >
                <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                Order Page
              </a>
            )}
            <Link
              href={workHref(order.work)}
              className="inline-flex items-center gap-1.5 rounded-sm border border-glass-border bg-bg-tertiary/30 px-2.5 py-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
            >
              <BookOpen className="h-3 w-3" strokeWidth={1.5} />
              View Work
            </Link>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="mt-6">
              <h3 className="type-caption mb-2">
                Notes
              </h3>
              <p className="text-xs leading-relaxed text-fg-secondary">
                {order.notes}
              </p>
            </div>
          )}
        </div>

        {/* Status promotion actions */}
        {validTransitions.length > 0 && (
          <div className="border-t border-glass-border p-4">
            <div className="flex gap-2">
              {/* Quick advance button */}
              {nextStatus && (
                <Button
                  variant="primary"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleStatusChange(nextStatus)}
                  disabled={isPending}
                >
                  {isPending ? (
                    <RefreshCw
                      className="h-3.5 w-3.5 animate-spin"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <>
                      <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                      Mark as {STATUS_LABELS[nextStatus] ?? nextStatus}
                    </>
                  )}
                </Button>
              )}

              {/* All transitions dropdown */}
              <div className="relative" ref={statusDropdownRef}>
                <Button
                  aria-label="Change status"
                  data-tooltip="Change status"
                  variant="secondary"
                  size="sm"
                  onClick={() => setStatusDropdownOpen((prev) => !prev)}
                  disabled={isPending}
                >
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                </Button>

                {statusDropdownOpen && (
                  <div className="glass absolute bottom-full right-0 mb-1 w-48">
                    {validTransitions.map((s) => {
                      const isDestructive =
                        s === "cancelled" || s === "returned";
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => handleStatusChange(s)}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-bg-tertiary ${
                            isDestructive
                              ? "text-accent-red-text hover:text-accent-red-text"
                              : "text-fg-secondary hover:text-fg-primary"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              STATUS_COLORS[s]?.replace("text-", "bg-") ??
                              "bg-fg-muted"
                            }`}
                          />
                          {STATUS_LABELS[s] ?? s}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <OrderEditDialog
        order={order}
        open={showEditDialog}
        onClose={() => setShowEditDialog(false)}
      />
    </>
  );
}
