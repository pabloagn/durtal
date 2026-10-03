"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import { createVenue, searchVenues } from "@/lib/actions/venues";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import type { VenueType } from "@/lib/catalogue/venues";
import { SingleChoiceField, useOrganizationSearch } from "./record-fields";
import type { PickerChoice } from "./search-picker";

/*
 * The parts of a personal copy that every collection shares: where it is
 * kept, how and when it came, and how it went. Each form keeps its own state
 * and lays these parts out among its own fields.
 */

/** A number as typed, or null when the field is empty; NaN when it is not a number */
export function readNumber(text: string) {
  const trimmed = text.trim().replace(",", ".");
  return trimmed ? Number(trimmed) : null;
}

/** A stored number as the text of its field */
export function numberText(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

/** What is wrong with a price and its currency, in the words of the form; null when nothing */
export function priceError(price: string, currency: string) {
  const value = readNumber(price);
  const code = currency.trim();
  if (value !== null && (!Number.isFinite(value) || value < 0))
    return "Enter a price of 0 or more";
  if ((value === null) !== !code) return "A price needs its currency, and a currency its price";
  if (code && !/^[A-Z]{3}$/.test(code)) return "Use a three-letter code: EUR, GBP, USD";
  return null;
}

export interface StorageLocation {
  id: string;
  name: string;
  subLocations: { id: string; name: string }[];
}

/** Where the copy is kept: a location, then a shelf or place in it */
export function StorageFields({
  locations,
  locationId,
  subLocationId,
  onLocation,
  onSubLocation,
  placeholder = "Not recorded",
}: {
  locations: StorageLocation[];
  locationId: string;
  subLocationId: string;
  /** The location changed; the shelf starts again */
  onLocation: (id: string) => void;
  onSubLocation: (id: string) => void;
  placeholder?: string;
}) {
  const location = locations.find((l) => l.id === locationId);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Select
        label="Kept in"
        value={locationId}
        placeholder={placeholder}
        onChange={(e) => onLocation(e.target.value)}
        options={locations.map((l) => ({ value: l.id, label: l.name }))}
      />
      {location && location.subLocations.length > 0 && (
        <Select
          label="Shelf or place"
          value={subLocationId}
          placeholder="Anywhere in it"
          onChange={(e) => onSubLocation(e.target.value)}
          options={location.subLocations.map((s) => ({ value: s.id, label: s.name }))}
        />
      )}
    </div>
  );
}

/** How a disposed copy went: since when, and how */
export function DisposalFields({
  disposed,
  reason,
  onDisposed,
  onReason,
  reasonPlaceholder,
}: {
  disposed: CatalogueDateInput | null;
  reason: string;
  /** The date and its error, if any */
  onDisposed: (value: CatalogueDateInput | null, error: string | null) => void;
  onReason: (reason: string) => void;
  reasonPlaceholder: string;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CatalogueDateField label="Gone since" value={disposed} onChange={onDisposed} />
      <Input
        label="How it went"
        value={reason}
        onChange={(e) => onReason(e.target.value)}
        placeholder={reasonPlaceholder}
        maxLength={1000}
      />
    </div>
  );
}

export interface AcquisitionDraft {
  acquired: CatalogueDateInput | null;
  supplier: { id: string; label: string } | null;
  venue: { id: string; label: string } | null;
  price: string;
  currency: string;
}

/**
 * How and when the copy came: the date, the seller (an organization with the
 * retailer role, given on save), the shop, and the price in its currency.
 */
export function AcquisitionFields({
  value,
  onChange,
  onDateError,
  shopType,
}: {
  value: AcquisitionDraft;
  onChange: (value: AcquisitionDraft) => void;
  onDateError: (error: string | null) => void;
  /** The kind of a shop created from the search: a perfumery, a bookshop */
  shopType: VenueType;
}) {
  const suppliers = useOrganizationSearch("retailer");
  const searchShops = useCallback(
    async (query: string): Promise<PickerChoice[]> =>
      (await searchVenues(query)).map((v) => ({
        id: v.id,
        label: v.name,
        hint: v.place?.name ?? null,
      })),
    [],
  );
  const createShop = useCallback(
    async (name: string): Promise<PickerChoice> => {
      const created = await createVenue({ name, type: shopType });
      return { id: created.id, label: created.name };
    },
    [shopType],
  );
  const error = priceError(value.price, value.currency);
  return (
    <fieldset className="space-y-3">
      <legend className="type-group-title mb-3">Acquisition</legend>
      <CatalogueDateField
        label="Acquired"
        value={value.acquired}
        onChange={(acquired, dateError) => {
          onChange({ ...value, acquired });
          onDateError(dateError);
        }}
      />
      <div className="space-y-2">
        <SingleChoiceField
          label="Supplier"
          value={value.supplier}
          onChange={(supplier) => onChange({ ...value, supplier })}
          search={suppliers.search}
          onCreate={suppliers.create}
          placeholder="Search sellers..."
        />
        <SingleChoiceField
          label="Shop"
          value={value.venue}
          onChange={(venue) => onChange({ ...value, venue })}
          search={searchShops}
          onCreate={createShop}
          placeholder="Search shops..."
        />
      </div>
      <div className="grid max-w-sm grid-cols-[1fr_6rem] gap-4">
        <Input
          label="Price"
          inputMode="decimal"
          value={value.price}
          onChange={(e) => onChange({ ...value, price: e.target.value })}
          placeholder="0.00"
        />
        <Input
          label="Currency"
          value={value.currency}
          onChange={(e) => onChange({ ...value, currency: e.target.value.toUpperCase() })}
          placeholder="EUR"
          maxLength={3}
        />
      </div>
      {(value.price || value.currency) && error && (
        <p className="text-xs text-accent-red-text">{error}</p>
      )}
    </fieldset>
  );
}
