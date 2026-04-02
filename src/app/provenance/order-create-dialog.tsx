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
import { DatePicker } from "@/components/ui/date-picker";
import { createOrder, searchWorksForOrder } from "@/lib/actions/orders";
import { createWork } from "@/lib/actions/works";
import { findOrCreateAuthor, searchAuthorsLite } from "@/lib/actions/authors";
import type { AcquisitionMethod, OrderStatus } from "@/lib/constants/orders";
import { getValidInitialStatuses } from "@/lib/constants/orders";
import {
  CURRENCY_SELECT_OPTIONS,
  DEFAULT_CURRENCY,
} from "@/lib/constants/currencies";

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

// H2: status labels used to build method-filtered options
const STATUS_LABEL_MAP: Record<OrderStatus, string> = {
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

function getStatusOptionsForMethod(
  method: AcquisitionMethod,
): { value: OrderStatus; label: string }[] {
  return getValidInitialStatuses(method).map((s) => ({
    value: s,
    label: STATUS_LABEL_MAP[s],
  }));
}

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

  // Inline work creation state
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [authorQuery, setAuthorQuery] = useState("");
  const [authorResults, setAuthorResults] = useState<
    { id: string; name: string }[]
  >([]);
  const [isSearchingAuthors, setIsSearchingAuthors] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const authorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Work search effect
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

  // Author search effect
  useEffect(() => {
    if (authorDebounceRef.current) clearTimeout(authorDebounceRef.current);
    if (!authorQuery.trim()) {
      setAuthorResults([]);
      return;
    }
    authorDebounceRef.current = setTimeout(async () => {
      setIsSearchingAuthors(true);
      try {
        const res = await searchAuthorsLite(authorQuery);
        setAuthorResults(res);
      } finally {
        setIsSearchingAuthors(false);
      }
    }, 300);
    return () => {
      if (authorDebounceRef.current) clearTimeout(authorDebounceRef.current);
    };
  }, [authorQuery]);

  async function handleCreateWork() {
    if (!newTitle.trim() || !authorQuery.trim()) return;
    setIsCreating(true);
    try {
      // Find or create the author
      const author = await findOrCreateAuthor(authorQuery.trim());

      // Create the work with minimal fields
      const work = await createWork({
        title: newTitle.trim(),
        authorIds: [{ authorId: author.id, role: "author" }],
        catalogueStatus: "on_order",
      });

      // Build a WorkResult-compatible object so the parent can use it
      const workResult: WorkResult = {
        id: work.id,
        title: work.title,
        slug: work.slug ?? "",
        workAuthors: [{ author: { id: author.id, name: author.name } }],
        media: [],
      };

      onSelect(workResult);
      setShowCreate(false);
      setNewTitle("");
      setAuthorQuery("");
      toast.success(`Created "${work.title}" and selected it`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create work",
      );
    } finally {
      setIsCreating(false);
    }
  }

  // Inline creation form
  if (showCreate) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-fg-secondary">
            Add a new work to the library.
          </p>
          <button
            type="button"
            onClick={() => setShowCreate(false)}
            className="text-xs text-fg-muted transition-colors hover:text-fg-secondary"
          >
            Back to search
          </button>
        </div>

        <Input
          label="Title"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Book title"
          required
          autoFocus
        />

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-fg-secondary">
            Author <span className="ml-0.5 text-accent-red">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={authorQuery}
              onChange={(e) => setAuthorQuery(e.target.value)}
              placeholder="Author name"
              className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent-rose focus:outline-none"
            />
            {isSearchingAuthors && (
              <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-fg-muted" strokeWidth={1.5} />
            )}
          </div>

          {/* Author autocomplete dropdown */}
          {authorQuery.trim() && authorResults.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-sm border border-glass-border bg-bg-secondary">
              {authorResults.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setAuthorQuery(a.name);
                    setAuthorResults([]);
                  }}
                  className="flex w-full items-center px-3 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}

          {authorQuery.trim() &&
            !isSearchingAuthors &&
            authorResults.length === 0 && (
              <p className="text-xs text-fg-muted">
                No existing author found. A new author &ldquo;{authorQuery.trim()}&rdquo; will be created.
              </p>
            )}
        </div>

        <Button
          variant="primary"
          size="sm"
          className="w-full"
          onClick={handleCreateWork}
          disabled={!newTitle.trim() || !authorQuery.trim() || isCreating}
        >
          {isCreating ? (
            <>
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                strokeWidth={1.5}
              />
              Creating...
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Create Work & Select
            </>
          )}
        </Button>
      </div>
    );
  }

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
                  {selectedWork.title?.[0] ?? "?"}
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
                        {work.title?.[0] ?? "?"}
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
        <div className="space-y-3 text-center">
          <p className="text-xs text-fg-muted">
            No works found for &ldquo;{query}&rdquo;
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setNewTitle(query.trim());
              setShowCreate(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Add New Work
          </Button>
        </div>
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
  // H2: filter status options by method
  const statusOptions = getStatusOptionsForMethod(method);

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-secondary">
        How are you acquiring this work?
      </p>
      <Select
        label="Acquisition Method"
        options={ACQUISITION_METHOD_OPTIONS}
        value={method}
        onChange={(e) => {
          const newMethod = e.target.value as AcquisitionMethod;
          onMethodChange(newMethod);
          // Auto-reset status to the first valid option for the new method
          const validStatuses = getValidInitialStatuses(newMethod);
          if (!validStatuses.includes(status)) {
            onStatusChange(validStatuses[0]);
          }
        }}
        required
      />
      <Select
        label="Initial Status"
        options={statusOptions}
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

      <DatePicker
        label="Order / Acquisition Date"
        value={form.orderDate}
        onChange={(v) => onChange("orderDate", v)}
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
          <DatePicker
            label="Estimated Delivery Date"
            value={form.estimatedDeliveryDate}
            onChange={(v) => onChange("estimatedDeliveryDate", v)}
            min={form.orderDate || undefined}
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
        <Select
          label="Currency"
          options={CURRENCY_SELECT_OPTIONS}
          value={form.currency}
          onChange={(e) => onChange("currency", e.target.value)}
          placeholder="Select"
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

function getInitialCurrency(): string {
  if (typeof window === "undefined") return DEFAULT_CURRENCY;
  return localStorage.getItem("durtal:preferred-currency") ?? DEFAULT_CURRENCY;
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
  currency: DEFAULT_CURRENCY,
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
  const [details, setDetails] = useState<DetailsForm>(() => ({
    ...INITIAL_DETAILS,
    currency: getInitialCurrency(),
  }));
  const [notes, setNotes] = useState("");

  function resetForm() {
    setStep(0);
    setSelectedWork(null);
    setMethod("online_order");
    setStatus("placed");
    setDetails({ ...INITIAL_DETAILS, currency: getInitialCurrency() });
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

    // H1: use !== "" instead of falsy check so "0" is preserved
    const priceVal = details.price !== "" ? details.price : null;
    const shippingVal = details.shippingCost !== "" ? details.shippingCost : null;
    const total =
      priceVal != null && shippingVal != null
        ? String(parseFloat(priceVal) + parseFloat(shippingVal))
        : priceVal ?? shippingVal ?? null;

    startTransition(async () => {
      try {
        // Remember the currency preference for next order
        if (details.currency) {
          localStorage.setItem("durtal:preferred-currency", details.currency);
        }
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
        className="max-w-3xl"
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
