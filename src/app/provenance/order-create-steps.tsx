"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Loader2, Search } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TitleInput } from "@/components/shared/title-input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { searchWorksForOrder } from "@/lib/actions/orders";
import { searchAuthorsLite } from "@/lib/actions/authors";
import { todayLocal } from "@/lib/utils/date";
import type { AcquisitionMethod, OrderStatus } from "@/lib/constants/orders";
import { getValidInitialStatuses } from "@/lib/constants/orders";
import {
  CURRENCY_SELECT_OPTIONS,
  DEFAULT_CURRENCY,
  currencySymbol,
} from "@/lib/constants/currencies";
import { STATUS_LABELS, getPosterUrl, getPosterStyle, getAuthorName } from "./order-model";
import { isComposing } from "@/lib/shortcuts/shortcuts";

// The steps of the new-order dialog: the book, how it was acquired, the details and the notes.

export interface WorkResult {
  id: string;
  /** A book typed in this dialog: created with the order, not before */
  draft?: { title: string; authorName: string };
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
    brightness: number | null;
    contrast: number | null;
  }>;
}

export const ACQUISITION_METHOD_OPTIONS: {
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

export function getStatusOptionsForMethod(
  method: AcquisitionMethod,
): { value: OrderStatus; label: string }[] {
  return getValidInitialStatuses(method).map((s) => ({
    value: s,
    label: STATUS_LABELS[s],
  }));
}

export function WorkSearchStep({
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
  // Esc closed the suggestions; typing shows them again (SLN-477)
  const [authorListClosed, setAuthorListClosed] = useState(false);
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

  // The new book is only a draft here: the order creates it with the order,
  // so a cancelled dialog or a failed order leaves no book behind
  function handleCreateWork() {
    const title = newTitle.trim();
    const authorName = authorQuery.trim();
    if (!title || !authorName) return;
    onSelect({
      id: "draft",
      draft: { title, authorName },
      title,
      slug: "",
      workAuthors: [{ author: { id: "", name: authorName } }],
      media: [],
    });
    setShowCreate(false);
    setNewTitle("");
    setAuthorQuery("");
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
            className="text-xs text-fg-secondary transition-colors hover:text-fg-primary"
          >
            Back to search
          </button>
        </div>

        <TitleInput
          label="Title"
          value={newTitle}
          onValueChange={setNewTitle}
          placeholder="Book title"
          required
          autoFocus
        />

        <div className="space-y-1.5">
          <label className="type-label block">
            Author <span className="ml-0.5 text-accent-red-text">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={authorQuery}
              onChange={(e) => {
                setAuthorQuery(e.target.value);
                setAuthorListClosed(false);
              }}
              // Esc closes the suggestions only, and keeps the name; the
              // dialog stays until the next Esc (SLN-477)
              onKeyDown={(e) => {
                if (
                  e.key === "Escape" &&
                  !isComposing(e) &&
                  !authorListClosed &&
                  authorQuery.trim() &&
                  authorResults.length > 0
                ) {
                  e.preventDefault();
                  setAuthorListClosed(true);
                }
              }}
              placeholder="Author name"
              // ↑ ↓ and Enter pick from the author suggestions
              data-picker=""
              className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent-rose focus:outline-none"
            />
            {isSearchingAuthors && (
              <Loader2
                className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-fg-muted"
                strokeWidth={1.5}
              />
            )}
          </div>

          {/* Author autocomplete dropdown */}
          {authorQuery.trim() && authorResults.length > 0 && !authorListClosed && (
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
            !authorListClosed &&
            authorResults.length === 0 && (
              <p className="text-xs text-fg-secondary">
                No existing author found. A new author &ldquo;
                {authorQuery.trim()}&rdquo; will be created.
              </p>
            )}
        </div>

        <Button
          variant="primary"
          size="sm"
          className="w-full"
          onClick={handleCreateWork}
          disabled={!newTitle.trim() || !authorQuery.trim()}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          Select new book
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
                style={getPosterStyle(selectedWork)}
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
        <Search
          className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
          strokeWidth={1.5}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title..."
          className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 pl-9 pr-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent-rose focus:outline-none"
          autoFocus
        />
        {isSearching && (
          <Loader2
            className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-fg-muted"
            strokeWidth={1.5}
          />
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
                      style={getPosterStyle(work)}
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
                  <p className="truncate text-xs text-fg-secondary">{authorName}</p>
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
          <p className="text-xs text-fg-secondary">
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

export function MethodStep({
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

export function DetailsStep({
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
        <Select
          label="Currency"
          options={CURRENCY_SELECT_OPTIONS}
          value={form.currency}
          onChange={(e) => onChange("currency", e.target.value)}
        />
        <Input
          label={`Price (${currencySymbol(form.currency) ?? form.currency})`}
          type="number"
          value={form.price}
          onChange={(e) => onChange("price", e.target.value)}
          placeholder="0.00"
        />
        <Input
          label={`Shipping (${currencySymbol(form.currency) ?? form.currency})`}
          type="number"
          value={form.shippingCost}
          onChange={(e) => onChange("shippingCost", e.target.value)}
          placeholder="0.00"
        />
      </div>
    </div>
  );
}

export function NotesStep({
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

export interface DetailsForm {
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

export const INITIAL_DETAILS: DetailsForm = {
  orderDate: todayLocal(),
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
