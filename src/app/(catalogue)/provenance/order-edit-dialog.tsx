"use client";

import {
  OrderTargetFields,
  type OrderTargetValue,
} from "@/components/publishers/order-target-fields";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { updateOrder } from "@/lib/actions/orders";
import {
  CURRENCY_SELECT_OPTIONS,
  currencySymbol,
  isSupportedCurrency,
} from "@/lib/constants/currencies";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import type { OrderStatus, AcquisitionMethod } from "@/lib/constants/orders";

interface OrderData {
  id: string;
  workId: string;
  /** A film, perfume or painting order keeps the target it was placed for */
  work?: { kind?: string | null };
  editionId?: string | null;
  acquisitionTargetId?: string | null;
  acquisitionMethod: AcquisitionMethod;
  status: OrderStatus;
  orderDate: string;
  orderConfirmation: string | null;
  orderUrl: string | null;
  price: string | null;
  shippingCost: string | null;
  totalCost: string | null;
  currency: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedDate: string | null;
  estimatedDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  notes: string | null;
}

const ACQUISITION_METHOD_OPTIONS: {
  value: AcquisitionMethod;
  label: string;
}[] = [
  { value: "online_order", label: "Online order" },
  { value: "in_store_purchase", label: "In-store purchase" },
  { value: "gift", label: "Gift" },
  { value: "digital_purchase", label: "Digital purchase" },
  { value: "auction", label: "Auction" },
  { value: "event_purchase", label: "Event purchase" },
];

interface OrderEditDialogProps {
  order: OrderData;
  open: boolean;
  onClose: () => void;
}

export function OrderEditDialog({
  order,
  open,
  onClose,
}: OrderEditDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [targetValue, setTargetValue] = useState<OrderTargetValue>({
    acquisitionTargetId: order.acquisitionTargetId ?? "",
    editionId: order.editionId ?? "",
  });
  const isBook = !order.work?.kind || order.work.kind === "book";
  const [method, setMethod] = useState(order.acquisitionMethod);
  const [orderDate, setOrderDate] = useState(order.orderDate);
  const [orderConfirmation, setOrderConfirmation] = useState(
    order.orderConfirmation ?? "",
  );
  const [orderUrl, setOrderUrl] = useState(order.orderUrl ?? "");
  const [price, setPrice] = useState(order.price ?? "");
  const [shippingCost, setShippingCost] = useState(order.shippingCost ?? "");
  // Orders saved without a currency get the home currency (Settings); saving stores it.
  const { homeCurrency } = useAppSettings();
  const [currency, setCurrency] = useState(() =>
    isSupportedCurrency(order.currency) ? order.currency : homeCurrency,
  );
  const [carrier, setCarrier] = useState(order.carrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(
    order.trackingNumber ?? "",
  );
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl ?? "");
  const [shippedDate, setShippedDate] = useState(order.shippedDate ?? "");
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState(
    order.estimatedDeliveryDate ?? "",
  );
  const [actualDeliveryDate, setActualDeliveryDate] = useState(
    order.actualDeliveryDate ?? "",
  );
  const [notes, setNotes] = useState(order.notes ?? "");

  const isOnline = method === "online_order" || method === "digital_purchase";
  const isAuction = method === "auction";
  const isGift = method === "gift";
  const showShipping = isOnline || isAuction;

  function handleSubmit() {
    // H1: use !== "" instead of falsy check so "0" is preserved
    const priceVal = price !== "" ? price : null;
    const shippingVal = shippingCost !== "" ? shippingCost : null;
    const total =
      priceVal != null && shippingVal != null
        ? String(parseFloat(priceVal) + parseFloat(shippingVal))
        : (priceVal ?? shippingVal ?? null);

    // M6: null out shipping-specific fields when method doesn't use shipping
    const carrierVal = showShipping ? carrier || null : null;
    const trackingNumberVal = showShipping ? trackingNumber || null : null;
    const trackingUrlVal = showShipping ? trackingUrl || null : null;
    const shippedDateVal = showShipping ? shippedDate || null : null;
    const estimatedDeliveryDateVal = showShipping
      ? estimatedDeliveryDate || null
      : null;
    const actualDeliveryDateVal =
      showShipping || isGift ? actualDeliveryDate || null : null;

    startTransition(async () => {
      try {
        await updateOrder(order.id, {
          acquisitionMethod: method,
          ...(isBook
            ? {
                acquisitionTargetId: targetValue.acquisitionTargetId || null,
                editionId: targetValue.editionId || null,
              }
            : {}),
          orderDate,
          orderConfirmation: showShipping ? orderConfirmation || null : null,
          orderUrl: showShipping ? orderUrl || null : null,
          price: priceVal,
          shippingCost: shippingVal,
          totalCost: total,
          currency,
          carrier: carrierVal,
          trackingNumber: trackingNumberVal,
          trackingUrl: trackingUrlVal,
          shippedDate: shippedDateVal,
          estimatedDeliveryDate: estimatedDeliveryDateVal,
          actualDeliveryDate: actualDeliveryDateVal,
          notes: notes || null,
        });
        toast.success("Order updated");
        onClose();
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update order",
        );
      }
    });
  }

  return (
    <Dialog
      draft
      open={open}
      onClose={onClose}
      title="Edit order"
      className="max-w-2xl"
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {isBook && (
          <OrderTargetFields
            workId={order.workId}
            value={targetValue}
            onChange={setTargetValue}
          />
        )}
        <Select
          label="Acquisition method"
          options={ACQUISITION_METHOD_OPTIONS}
          value={method}
          onChange={(e) => setMethod(e.target.value as AcquisitionMethod)}
        />

        <DatePicker
          label="Order date"
          value={orderDate}
          onChange={(v) => setOrderDate(v)}
          required
        />

        {showShipping && (
          <>
            <Input
              label="Order Confirmation #"
              value={orderConfirmation}
              onChange={(e) => setOrderConfirmation(e.target.value)}
            />
            <Input
              label="Order URL"
              type="url"
              value={orderUrl}
              onChange={(e) => setOrderUrl(e.target.value)}
              placeholder="https://..."
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Carrier"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="USPS, UPS, DHL..."
              />
              <Input
                label="Tracking number"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
              />
            </div>
            <Input
              label="Tracking URL"
              type="url"
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
              placeholder="https://..."
            />
            <div className="grid grid-cols-2 gap-3">
              <DatePicker
                label="Shipped date"
                value={shippedDate}
                onChange={(v) => setShippedDate(v)}
                min={orderDate || undefined}
              />
              <DatePicker
                label="Estimated delivery"
                value={estimatedDeliveryDate}
                onChange={(v) => setEstimatedDeliveryDate(v)}
                min={orderDate || undefined}
              />
            </div>
            <DatePicker
              label="Actual delivery date"
              value={actualDeliveryDate}
              onChange={(v) => setActualDeliveryDate(v)}
              min={orderDate || undefined}
            />
          </>
        )}

        {isGift && (
          <DatePicker
            label="Received date"
            value={actualDeliveryDate}
            onChange={(v) => setActualDeliveryDate(v)}
          />
        )}

        <div className="grid grid-cols-3 gap-3">
          <Select
            label="Currency"
            options={CURRENCY_SELECT_OPTIONS}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
          <Input
            label={`Price (${currencySymbol(currency) ?? currency})`}
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
          />
          <Input
            label={`Shipping (${currencySymbol(currency) ?? currency})`}
            type="number"
            value={shippingCost}
            onChange={(e) => setShippingCost(e.target.value)}
            placeholder="0.00"
          />
        </div>

        <Textarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Collector notes..."
        />
      </div>

      <div className="mt-5 flex items-center justify-end gap-3 border-t border-glass-border pt-4">
        <Button data-dismiss=""
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          busy={isPending}
          disabled={!orderDate}
        >
          Save changes
        </Button>
      </div>
    </Dialog>
  );
}
