"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { updateOrder } from "@/lib/actions/orders";
import {
  CURRENCY_SELECT_OPTIONS,
} from "@/lib/constants/currencies";
import type { OrderStatus, AcquisitionMethod } from "@/lib/constants/orders";

interface OrderData {
  id: string;
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
  { value: "online_order", label: "Online Order" },
  { value: "in_store_purchase", label: "In-Store Purchase" },
  { value: "gift", label: "Gift" },
  { value: "digital_purchase", label: "Digital Purchase" },
  { value: "auction", label: "Auction" },
  { value: "event_purchase", label: "Event Purchase" },
];

interface OrderEditDialogProps {
  order: OrderData;
  open: boolean;
  onClose: () => void;
}

export function OrderEditDialog({ order, open, onClose }: OrderEditDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [method, setMethod] = useState(order.acquisitionMethod);
  const [orderDate, setOrderDate] = useState(order.orderDate);
  const [orderConfirmation, setOrderConfirmation] = useState(
    order.orderConfirmation ?? "",
  );
  const [orderUrl, setOrderUrl] = useState(order.orderUrl ?? "");
  const [price, setPrice] = useState(order.price ?? "");
  const [shippingCost, setShippingCost] = useState(order.shippingCost ?? "");
  const [currency, setCurrency] = useState(order.currency ?? "EUR");
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
    const priceVal = price || null;
    const shippingVal = shippingCost || null;
    const total =
      priceVal && shippingVal
        ? String(parseFloat(priceVal) + parseFloat(shippingVal))
        : priceVal ?? shippingVal ?? null;

    startTransition(async () => {
      try {
        await updateOrder(order.id, {
          acquisitionMethod: method,
          orderDate,
          orderConfirmation: orderConfirmation || null,
          orderUrl: orderUrl || null,
          price: priceVal,
          shippingCost: shippingVal,
          totalCost: total,
          currency: currency || null,
          carrier: carrier || null,
          trackingNumber: trackingNumber || null,
          trackingUrl: trackingUrl || null,
          shippedDate: shippedDate || null,
          estimatedDeliveryDate: estimatedDeliveryDate || null,
          actualDeliveryDate: actualDeliveryDate || null,
          notes: notes || null,
        });
        if (currency) {
          localStorage.setItem("durtal:preferred-currency", currency);
        }
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
      open={open}
      onClose={onClose}
      title="Edit Order"
      className="max-w-2xl"
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <Select
          label="Acquisition Method"
          options={ACQUISITION_METHOD_OPTIONS}
          value={method}
          onChange={(e) =>
            setMethod(e.target.value as AcquisitionMethod)
          }
        />

        <DatePicker
          label="Order Date"
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
                label="Tracking Number"
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
                label="Shipped Date"
                value={shippedDate}
                onChange={(v) => setShippedDate(v)}
                min={orderDate || undefined}
              />
              <DatePicker
                label="Estimated Delivery"
                value={estimatedDeliveryDate}
                onChange={(v) => setEstimatedDeliveryDate(v)}
                min={orderDate || undefined}
              />
            </div>
            <DatePicker
              label="Actual Delivery Date"
              value={actualDeliveryDate}
              onChange={(v) => setActualDeliveryDate(v)}
              min={orderDate || undefined}
            />
          </>
        )}

        {isGift && (
          <DatePicker
            label="Received Date"
            value={actualDeliveryDate}
            onChange={(v) => setActualDeliveryDate(v)}
          />
        )}

        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Price"
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
          />
          <Input
            label="Shipping"
            type="number"
            value={shippingCost}
            onChange={(e) => setShippingCost(e.target.value)}
            placeholder="0.00"
          />
          <Select
            label="Currency"
            options={CURRENCY_SELECT_OPTIONS}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="Select"
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
        <Button
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
          disabled={isPending || !orderDate}
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              Saving
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>
    </Dialog>
  );
}
