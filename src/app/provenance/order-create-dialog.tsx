"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { createOrder } from "@/lib/actions/orders";
import { searchWorksForOrder } from "@/lib/actions/orders";
import type { AcquisitionMethod, OrderStatus } from "@/lib/constants/orders";

// ── Types ──────────────────────────────────────────────────────────────────────

interface WorkResult {
  id: string;
  title: string;
  slug: string;
  workAuthors: Array<{
    author: { id: string; name: string };
  }>;
  media: Array<{
    s3Key: string;
    thumbnailS3Key: string | null;
    type: string;
    isActive: boolean;
    cropX: number | null;
    cropY: number | null;
    cropZoom: number | null;
  }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

const ORDER_STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: "placed", label: "Placed" },
  { value: "confirmed", label: "Confirmed" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "in_transit", label: "In Transit" },
  { value: "out_for_delivery", label: "Out for Delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "purchased", label: "Purchased" },
  { value: "received", label: "Received" },
  { value: "bid", label: "Bid" },
  { value: "won", label: "Won" },
  { value: "cancelled", label: "Cancelled" },
  { value: "returned", label: "Returned" },
];

function getPosterUrl(work: WorkResult): string | null {
  const poster = work.media.find((m) => m.type === "poster" && m.isActive);
  if (!poster) return null;
  const key = poster.thumbnailS3Key ?? poster.s3Key;
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}

function getAuthorName(work: WorkResult): string {
  return work.workAuthors[0]?.author?.name ?? "Unknown Author";
}

// ── Step components ───────────────────────────────────────────────────────────

function WorkSearchStep({
  selectedWork,
  onSelect,
}: {
  selectedWork: WorkResult | null;
  onSelect: (work: WorkResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await searchWorksForOrder(query);
        setResults(res as WorkResult[]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-secondary">
        Search for the work you are acquiring.
      </p>

      {selectedWork && (
        <div className="flex items-center gap-3 rounded-sm border border-accent-rose/20 bg-accent-plum/40 p-3">
          <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
            {getPosterUrl(selectedWork) ? (
              <Image
                src={getPosterUrl(selectedWork)!}
                alt={selectedWork.title}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="font-serif text-sm text-fg-muted/40">
                  {selectedWork.title[0]}
                </span>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg-primary">
              {selectedWork.title}
            </p>
            <p className="truncate text-xs text-fg-secondary">
              {getAuthorName(selectedWork)}
            </p>
          </div>
          <span className="ml-auto font-mono text-micro text-accent-sage">
            selected
          </span>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" strokeWidth={1.5} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title..."
          className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 pl-9 pr-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent-rose focus:outline-none"
          autoFocus
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-fg-muted" strokeWidth={1.5} />
        )}
      </div>

      {results.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-sm border border-glass-border bg-bg-secondary">
          {results.map((work) => {
            const posterUrl = getPosterUrl(work);
            const authorName = getAuthorName(work);
            const isSelected = selectedWork?.id === work.id;
            return (
              <button
                key={work.id}
                type="button"
                onClick={() => onSelect(work)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-tertiary ${
                  isSelected ? "bg-accent-plum/40" : ""
                }`}
              >
                <div className="relative h-10 w-7 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
                  {posterUrl ? (
                    <Image
                      src={posterUrl}
                      alt={work.title}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="font-serif text-xs text-fg-muted/40">
                        {work.title[0]}
                      </span>
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg-primary">
                    {work.title}
                  </p>
                  <p className="truncate text-xs text-fg-muted">{authorName}</p>
                </div>
                {isSelected && (
                  <span className="ml-auto font-mono text-micro text-accent-sage">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {query.trim() && !isSearching && results.length === 0 && (
        <p className="text-center text-xs text-fg-muted">
          No works found for &ldquo;{query}&rdquo;
        </p>
      )}
    </div>
  );
}

function MethodStep({
  method,
  onMethodChange,
  status,
  onStatusChange,
}: {
  method: AcquisitionMethod;
  onMethodChange: (v: AcquisitionMethod) => void;
  status: OrderStatus;
  onStatusChange: (v: OrderStatus) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-secondary">
        How are you acquiring this work?
      </p>
      <Select
        label="Acquisition Method"
        options={ACQUISITION_METHOD_OPTIONS}
        value={method}
        onChange={(e) => onMethodChange(e.target.value as AcquisitionMethod)}
        required
      />
      <Select
        label="Initial Status"
        options={ORDER_STATUS_OPTIONS}
        value={status}
        onChange={(e) => onStatusChange(e.target.value as OrderStatus)}
      />
    </div>
  );
}

function DetailsStep({
  method,
  form,
  onChange,
}: {
  method: AcquisitionMethod;
  form: DetailsForm;
  onChange: (key: keyof DetailsForm, value: string) => void;
}) {
  const isOnline = method === "online_order" || method === "digital_purchase";
  const isAuction = method === "auction";
  const isGift = method === "gift";

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-secondary">
        Fill in the acquisition details.
      </p>

      <Input
        label="Order / Acquisition Date"
        type="date"
        value={form.orderDate}
        onChange={(e) => onChange("orderDate", e.target.value)}
        required
      />

      {(isOnline || isAuction) && (
        <>
          <Input
            label="Venue / Seller"
            value={form.venueName}
            onChange={(e) => onChange("venueName", e.target.value)}
            placeholder="Amazon, AbeBooks, etc."
          />
          <Input
            label="Order Confirmation #"
            value={form.orderConfirmation}
            onChange={(e) => onChange("orderConfirmation", e.target.value)}
          />
          <Input
            label="Order URL"
            type="url"
            value={form.orderUrl}
            onChange={(e) => onChange("orderUrl", e.target.value)}
            placeholder="https://..."
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Carrier"
              value={form.carrier}
              onChange={(e) => onChange("carrier", e.target.value)}
              placeholder="USPS, UPS, DHL..."
            />
            <Input
              label="Tracking Number"
              value={form.trackingNumber}
              onChange={(e) => onChange("trackingNumber", e.target.value)}
            />
          </div>
          <Input
            label="Tracking URL"
            type="url"
            value={form.trackingUrl}
            onChange={(e) => onChange("trackingUrl", e.target.value)}
            placeholder="https://..."
          />
          <Input
            label="Estimated Delivery Date"
            type="date"
            value={form.estimatedDeliveryDate}
            onChange={(e) => onChange("estimatedDeliveryDate", e.target.value)}
          />
        </>
      )}

      {!isOnline && !isAuction && !isGift && (
        <Input
          label="Venue / Store"
          value={form.venueName}
          onChange={(e) => onChange("venueName", e.target.value)}
          placeholder="Bookshop name, event, etc."
        />
      )}

      {isGift && (
        <Input
          label="Gift From"
          value={form.originDescription}
          onChange={(e) => onChange("originDescription", e.target.value)}
          placeholder="Name of the person or organization"
        />
      )}

      <div className="grid grid-cols-3 gap-3">
        <Input
          label="Price"
          type="number"
          value={form.price}
          onChange={(e) => onChange("price", e.target.value)}
          placeholder="0.00"
        />
        <Input
          label="Shipping"
          type="number"
          value={form.shippingCost}
          onChange={(e) => onChange("shippingCost", e.target.value)}
          placeholder="0.00"
        />
        <Input
          label="Currency"
          value={form.currency}
          onChange={(e) => onChange("currency", e.target.value)}
          placeholder="EUR"
        />
      </div>
    </div>
  );
}

function NotesStep({
  notes,
  onChange,
}: {
  notes: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-secondary">Any additional notes?</p>
      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder="Collector notes, special circumstances, etc."
      />
    </div>
  );
}

// ── Main dialog ────────────────────────────────────────────────────────────────

interface DetailsForm {
  orderDate: string;
  venueName: string;
  orderConfirmation: string;
  orderUrl: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
  estimatedDeliveryDate: string;
  price: string;
  shippingCost: string;
  currency: string;
  originDescription: string;
}

const INITIAL_DETAILS: DetailsForm = {
  orderDate: new Date().toISOString().split("T")[0],
  venueName: "",
  orderConfirmation: "",
  orderUrl: "",
  carrier: "",
  trackingNumber: "",
  trackingUrl: "",
  estimatedDeliveryDate: "",
  price: "",
  shippingCost: "",
  currency: "",
  originDescription: "",
};

const STEP_LABELS = ["Work", "Method", "Details", "Notes"];

export function OrderCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Form state
  const [step, setStep] = useState(0);
  const [selectedWork, setSelectedWork] = useState<WorkResult | null>(null);
  const [method, setMethod] = useState<AcquisitionMethod>("online_order");
  const [status, setStatus] = useState<OrderStatus>("placed");
  const [details, setDetails] = useState<DetailsForm>(INITIAL_DETAILS);
  const [notes, setNotes] = useState("");

  function resetForm() {
    setStep(0);
    setSelectedWork(null);
    setMethod("online_order");
    setStatus("placed");
    setDetails(INITIAL_DETAILS);
    setNotes("");
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
    resetForm();
  }

  function handleDetailsChange(key: keyof DetailsForm, value: string) {
    setDetails((prev) => ({ ...prev, [key]: value }));
  }

  function canProceed(): boolean {
    switch (step) {
      case 0:
        return selectedWork !== null;
      case 1:
        return true;
      case 2:
        return Boolean(details.orderDate);
      case 3:
        return true;
      default:
        return false;
    }
  }

  function handleSubmit() {
    if (!selectedWork) {
      toast.error("Please select a work");
      return;
    }

    const priceVal = details.price ? details.price : null;
    const shippingVal = details.shippingCost ? details.shippingCost : null;
    const total =
      priceVal && shippingVal
        ? String(parseFloat(priceVal) + parseFloat(shippingVal))
        : priceVal ?? shippingVal ?? null;

    startTransition(async () => {
      try {
        await createOrder({
          workId: selectedWork.id,
          acquisitionMethod: method,
          status,
          orderDate: details.orderDate,
          orderConfirmation: details.orderConfirmation || null,
          orderUrl: details.orderUrl || null,
          carrier: details.carrier || null,
          trackingNumber: details.trackingNumber || null,
          trackingUrl: details.trackingUrl || null,
          estimatedDeliveryDate: details.estimatedDeliveryDate || null,
          price: priceVal,
          shippingCost: shippingVal,
          totalCost: total,
          currency: details.currency || null,
          originDescription: details.originDescription || null,
          notes: notes || null,
        });
        toast.success(`Order for "${selectedWork.title}" created`);
        setOpen(false);
        resetForm();
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create order",
        );
      }
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        New Order
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
        title="New Order"
        description={`Step ${step + 1} of ${STEP_LABELS.length} — ${STEP_LABELS[step]}`}
        className="max-w-xl"
      >
        {/* Step indicator */}
        <div className="mb-5 flex gap-1.5">
          {STEP_LABELS.map((label, i) => (
            <div
              key={label}
              className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                i <= step ? "bg-accent-rose/60" : "bg-glass-border"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[260px]">
          {step === 0 && (
            <WorkSearchStep
              selectedWork={selectedWork}
              onSelect={setSelectedWork}
            />
          )}
          {step === 1 && (
            <MethodStep
              method={method}
              onMethodChange={setMethod}
              status={status}
              onStatusChange={setStatus}
            />
          )}
          {step === 2 && (
            <DetailsStep
              method={method}
              form={details}
              onChange={handleDetailsChange}
            />
          )}
          {step === 3 && (
            <NotesStep notes={notes} onChange={setNotes} />
          )}
        </div>

        {/* Footer navigation */}
        <div className="mt-5 flex items-center justify-between border-t border-glass-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (step === 0 ? handleClose() : setStep((s) => s - 1))}
            disabled={isPending}
          >
            {step === 0 ? (
              "Cancel"
            ) : (
              <>
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                Back
              </>
            )}
          </Button>

          {step < STEP_LABELS.length - 1 ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed()}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={isPending || !selectedWork}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                  Creating
                </>
              ) : (
                "Create Order"
              )}
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
