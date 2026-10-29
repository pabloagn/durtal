"use client";

import { useState, useEffect, useRef, useCallback, useId } from "react";
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
import { searchVenues } from "@/lib/actions/venues";
import { createVenue } from "@/lib/actions/catalogue-client";
import {
  AddButton,
  CHIP,
  CHIP_NAME,
  RemoveButton,
  useAddButton,
} from "@/components/catalogue/record-fields";
import { SearchPicker, type PickerChoice } from "@/components/catalogue/search-picker";
import type { VenueType } from "@/lib/catalogue/venues";
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
import { useSaveReason } from "@/components/shared/save-reason";

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
  { value: "online_order", label: "Online order" },
  { value: "in_store_purchase", label: "In-store purchase" },
  { value: "gift", label: "Gift" },
  { value: "digital_purchase", label: "Digital purchase" },
  { value: "auction", label: "Auction" },
  { value: "event_purchase", label: "Event purchase" },
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

  const newBookReason = useSaveReason(
    !newTitle.trim() && !authorQuery.trim()
      ? "Add a title and author"
      : !newTitle.trim()
        ? "Add a title"
        : !authorQuery.trim() && "Add the author",
  );

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
            className="text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
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
              className="h-8 pointer-coarse:h-11 w-full rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent-primary focus:outline-none"
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

        {newBookReason.hint}
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          onClick={handleCreateWork}
          disabled={!newTitle.trim() || !authorQuery.trim()}
          aria-describedby={newBookReason.describedBy}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          Select new book
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {selectedWork && (
        <div className="flex items-center gap-3 rounded-sm border border-accent-primary/20 bg-selection-bg/40 p-3">
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
                {/* Decoration: the title is in the text beside it */}
                <span aria-hidden="true" data-decorative className="font-serif text-sm text-fg-muted/40">
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
          className="h-8 pointer-coarse:h-11 w-full rounded-sm border border-glass-border bg-bg-primary/80 pl-9 pr-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent-primary focus:outline-none"
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
                  isSelected ? "bg-selection-bg/40" : ""
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
                      {/* Decoration: the title is in the text beside it */}
                      <span aria-hidden="true" data-decorative className="font-serif text-xs text-fg-muted/40">
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
            Add a new book
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
      <Select
        label="Acquisition method"
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
        label="Initial status"
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
  venue,
  onVenueChange,
  priceLabel,
}: {
  method: AcquisitionMethod;
  form: DetailsForm;
  onChange: (key: keyof DetailsForm, value: string) => void;
  venue: OrderVenue | null;
  onVenueChange: (venue: OrderVenue | null) => void;
  priceLabel?: string;
}) {
  const isOnline = method === "online_order" || method === "digital_purchase";
  const isAuction = method === "auction";
  const isGift = method === "gift";

  return (
    <div className="space-y-4">
      <DatePicker
        label="Order date"
        value={form.orderDate}
        onChange={(v) => onChange("orderDate", v)}
        required
      />

      {(isOnline || isAuction) && (
        <>
          <OrderShopField method={method} value={venue} onChange={onVenueChange} />
          <Input
            label="Confirmation number"
            value={form.orderConfirmation}
            onChange={(e) => onChange("orderConfirmation", e.target.value)}
          />
          <Input
            label="Order link"
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
              label="Tracking number"
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
            label="Estimated delivery date"
            value={form.estimatedDeliveryDate}
            onChange={(v) => onChange("estimatedDeliveryDate", v)}
            min={form.orderDate || undefined}
          />
        </>
      )}

      {!isOnline && !isAuction && !isGift && (
        <OrderShopField method={method} value={venue} onChange={onVenueChange} />
      )}

      {isGift && (
        <Input
          label="Gift from"
          value={form.originDescription}
          onChange={(e) => onChange("originDescription", e.target.value)}
          placeholder="Name of the person or organization"
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select
          label="Currency"
          options={CURRENCY_SELECT_OPTIONS}
          value={form.currency}
          onChange={(e) => onChange("currency", e.target.value)}
        />
        <Input
          label={`${priceLabel ?? "Price"} (${currencySymbol(form.currency) ?? form.currency})`}
          type="number"
          value={form.price}
          onChange={(e) => onChange("price", e.target.value)}
          placeholder="0.00"
        />
        <Input
          label={`Shipping per order (${currencySymbol(form.currency) ?? form.currency})`}
          type="number"
          value={form.shippingCost}
          onChange={(e) => onChange("shippingCost", e.target.value)}
          placeholder="0.00"
        />
      </div>
    </div>
  );
}

export type OrderVenue = { id: string; label: string };

/** The kind of a shop first named in an order, by how the order was placed */
const SHOP_TYPE: Record<AcquisitionMethod, VenueType> = {
  online_order: "online_store",
  digital_purchase: "online_store",
  auction: "auction_house",
  in_store_purchase: "bookshop",
  event_purchase: "fair",
  gift: "other",
};

/**
 * Where the order was placed: one of the places, picked from a search, so a
 * shop has one name and its page lists every order from it (SLN-985). A shop
 * not in the places yet is added from the search.
 */
export function OrderShopField({
  method,
  value,
  onChange,
}: {
  method: AcquisitionMethod;
  value: OrderVenue | null;
  onChange: (venue: OrderVenue | null) => void;
}) {
  const search = useCallback(
    async (query: string): Promise<PickerChoice[]> =>
      (await searchVenues(query)).map((v) => ({
        id: v.id,
        label: v.name,
        hint: v.place?.name ?? null,
      })),
    [],
  );
  const create = useCallback(
    async (name: string): Promise<PickerChoice> => {
      const created = await createVenue({ name, type: SHOP_TYPE[method] });
      return { id: created.id, label: created.name };
    },
    [method],
  );
  const add = useAddButton();
  const labelId = useId();
  // Stacked as the form's other fields: the label over the chip or Choose
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-1.5">
      <span id={labelId} className="type-label block">
        Shop
      </span>
      {value ? (
        <span className={CHIP}>
          <span className={CHIP_NAME}>{value.label}</span>
          <RemoveButton label={`Remove ${value.label}`} onClick={() => onChange(null)} />
        </span>
      ) : add.open ? (
        <SearchPicker
          label="Search: shop"
          placeholder="Search shops..."
          search={search}
          onCreate={create}
          onPick={(choice) => {
            add.close();
            onChange({ id: choice.id, label: choice.label });
          }}
          onClose={add.close}
        />
      ) : (
        // A ghost button under its label pulls out by its padding, so its
        // icon starts on the label's edge (docs/03, Spacing Scale)
        <div className="-ml-1.5">
          <AddButton
            label="Choose: shop"
            text="Choose"
            onClick={() => add.setOpen(true)}
            buttonRef={add.button}
          />
        </div>
      )}
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
