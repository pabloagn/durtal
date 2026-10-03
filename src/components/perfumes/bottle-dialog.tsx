"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import { addPerfumeBottle, updatePerfumeBottle } from "@/lib/actions/perfumes";
import { createVenue, searchVenues } from "@/lib/actions/venues";
import { PERFUME_CONTAINERS } from "@/lib/catalogue/perfumes";
import { PERSONAL_HOLDING_STATUSES } from "@/lib/catalogue/holdings";
import {
  CONTAINER_LABELS,
  HOLDING_STATUS_LABELS,
  formatVolume,
  type HoldingStatus,
  type PerfumeContainer,
} from "@/lib/catalogue/perfume-labels";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import { SingleChoiceField, useOrganizationSearch } from "./perfume-fields";
import type { PickerChoice } from "./search-picker";

/** A stored bottle, sample or decant, as the edit dialog starts from it */
export interface EditableBottle {
  id: string;
  fingerprint: string;
  variantId: string;
  container: PerfumeContainer;
  capacityValue: number;
  volumeUnit: "ml" | "l";
  remainingMl: number | null;
  status: HoldingStatus;
  batchCode: string | null;
  condition: string | null;
  locationId: string | null;
  subLocationId: string | null;
  acquisitionDate: CatalogueDateInput | null;
  supplier: { id: string; label: string } | null;
  venue: { id: string; label: string } | null;
  acquisitionPrice: number | null;
  acquisitionCurrency: string | null;
  dispositionDate: CatalogueDateInput | null;
  dispositionReason: string | null;
  notes: string | null;
}

export interface StorageLocation {
  id: string;
  name: string;
  subLocations: { id: string; name: string }[];
}

/** A number as typed, or null when the field is empty; NaN when it is not a number */
function readNumber(text: string) {
  const trimmed = text.trim().replace(",", ".");
  return trimmed ? Number(trimmed) : null;
}
function text(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Adds or edits a bottle, sample or decant of one formulation: its size and
 * what is left, where it is kept, how and when it came, and how it went.
 * Anything not known stays empty.
 */
export function BottleDialog({
  open,
  onClose,
  perfumeTitle,
  formulations,
  locations,
  bottle,
  initialFormulationId,
}: {
  open: boolean;
  onClose: () => void;
  perfumeTitle: string;
  formulations: { id: string; label: string }[];
  /** Physical storage only: perfume cannot be kept in a digital location */
  locations: StorageLocation[];
  bottle?: EditableBottle;
  initialFormulationId?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={bottle ? `Edit ${CONTAINER_LABELS[bottle.container].one.toLowerCase()}` : "Add bottle or sample"}
      description={perfumeTitle}
      className="max-w-3xl"
    >
      {open && (
        <BottleForm
          formulations={formulations}
          locations={locations}
          bottle={bottle}
          initialFormulationId={initialFormulationId}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
}

function BottleForm({
  formulations,
  locations,
  bottle,
  initialFormulationId,
  onDone,
}: {
  formulations: { id: string; label: string }[];
  locations: StorageLocation[];
  bottle?: EditableBottle;
  initialFormulationId?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [variantId, setVariantId] = useState(
    bottle?.variantId ?? initialFormulationId ?? formulations[0]?.id ?? "",
  );
  const [container, setContainer] = useState<PerfumeContainer>(bottle?.container ?? "bottle");
  const [capacity, setCapacity] = useState(text(bottle?.capacityValue));
  const [unit, setUnit] = useState<"ml" | "l">(bottle?.volumeUnit ?? "ml");
  const [remaining, setRemaining] = useState(text(bottle?.remainingMl));
  const [status, setStatus] = useState<HoldingStatus>(bottle?.status ?? "held");
  const [batchCode, setBatchCode] = useState(bottle?.batchCode ?? "");
  const [condition, setCondition] = useState(bottle?.condition ?? "");
  const [locationId, setLocationId] = useState(bottle?.locationId ?? "");
  const [subLocationId, setSubLocationId] = useState(bottle?.subLocationId ?? "");
  const [acquired, setAcquired] = useState(bottle?.acquisitionDate ?? null);
  const [supplier, setSupplier] = useState(bottle?.supplier ?? null);
  const [venue, setVenue] = useState(bottle?.venue ?? null);
  const [price, setPrice] = useState(text(bottle?.acquisitionPrice));
  const [currency, setCurrency] = useState(bottle?.acquisitionCurrency ?? "");
  const [disposed, setDisposed] = useState(bottle?.dispositionDate ?? null);
  const [reason, setReason] = useState(bottle?.dispositionReason ?? "");
  const [notes, setNotes] = useState(bottle?.notes ?? "");
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const createShop = useCallback(async (name: string): Promise<PickerChoice> => {
    const created = await createVenue({ name, type: "perfumery" });
    return { id: created.id, label: created.name };
  }, []);

  // Field checks, in the words of the field they concern
  const capacityValue = readNumber(capacity);
  const capacityMl = capacityValue === null ? null : capacityValue * (unit === "l" ? 1000 : 1);
  const remainingMl = readNumber(remaining);
  const priceValue = readNumber(price);
  const capacityError =
    capacityValue === null
      ? "Enter the size"
      : !Number.isFinite(capacityValue) || capacityValue <= 0
        ? "Enter a size above 0"
        : null;
  const remainingError =
    remainingMl === null
      ? null
      : !Number.isFinite(remainingMl) || remainingMl < 0
        ? "Enter 0 or more"
        : capacityMl !== null && remainingMl > capacityMl
          ? "More than the size"
          : null;
  const priceError =
    priceValue !== null && (!Number.isFinite(priceValue) || priceValue < 0)
      ? "Enter a price of 0 or more"
      : (priceValue === null) !== !currency.trim()
        ? "A price needs its currency, and a currency its price"
        : currency.trim() && !/^[A-Z]{3}$/.test(currency.trim())
          ? "Use a three-letter code: EUR, GBP, USD"
          : null;
  const blocked =
    !variantId ||
    !!capacityError ||
    !!remainingError ||
    !!priceError ||
    Object.values(dateErrors).some(Boolean);
  const location = locations.find((l) => l.id === locationId);

  async function save() {
    if (blocked || saving || capacityValue === null) return;
    setSaving(true);
    setError(null);
    const isDisposed = status === "disposed";
    const fields = {
      variantId,
      container,
      capacityValue,
      volumeUnit: unit,
      remainingMl,
      status,
      batchCode: batchCode.trim() || null,
      condition: condition.trim() || null,
      locationId: locationId || null,
      subLocationId: (locationId && subLocationId) || null,
      acquisitionDate: acquired,
      supplierId: supplier?.id ?? null,
      venueId: venue?.id ?? null,
      acquisitionPrice: priceValue,
      acquisitionCurrency: currency.trim() || null,
      dispositionDate: isDisposed ? disposed : null,
      dispositionReason: isDisposed ? reason.trim() || null : null,
      notes: notes.trim() || null,
    };
    try {
      if (bottle) await updatePerfumeBottle(bottle.id, fields, bottle.fingerprint);
      else await addPerfumeBottle(fields);
      toast.success(bottle ? "Saved" : `${CONTAINER_LABELS[container].one} added`);
      onDone();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="Formulation"
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          options={formulations.map((f) => ({ value: f.id, label: f.label }))}
        />
        <fieldset>
          <legend className="type-label mb-1.5">Kind</legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Kind">
            {PERFUME_CONTAINERS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={container === kind}
                onClick={() => setContainer(kind)}
                className={`h-8 rounded-sm border px-3 text-sm transition-colors ${
                  container === kind
                    ? "border-accent-rose/40 bg-accent-plum text-fg-primary"
                    : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
                }`}
              >
                {CONTAINER_LABELS[kind].one}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_6rem_1fr]">
        <Input
          label="Size"
          inputMode="decimal"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          placeholder="75"
          error={capacity ? (capacityError ?? undefined) : undefined}
        />
        <Select
          label="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value as "ml" | "l")}
          options={[
            { value: "ml", label: "ml" },
            { value: "l", label: "l" },
          ]}
        />
        <Input
          label={capacityMl && !capacityError ? `Left, of ${formatVolume(capacityMl)}` : "Left (ml)"}
          inputMode="decimal"
          value={remaining}
          onChange={(e) => setRemaining(e.target.value)}
          placeholder="Unknown"
          error={remainingError ?? undefined}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as HoldingStatus)}
          options={PERSONAL_HOLDING_STATUSES.map((s) => ({ value: s, label: HOLDING_STATUS_LABELS[s] }))}
        />
        <Input
          label="Batch code"
          value={batchCode}
          onChange={(e) => setBatchCode(e.target.value)}
          maxLength={200}
        />
        <Input
          label="Condition"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="Boxed, sealed"
          maxLength={300}
        />
      </div>

      {status === "disposed" && (
        <div className="grid gap-4 md:grid-cols-2">
          <CatalogueDateField
            label="Gone since"
            value={disposed}
            onChange={(value, err) => {
              setDisposed(value);
              setDateErrors((e) => ({ ...e, disposed: err }));
            }}
          />
          <Input
            label="How it went"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Used up, given away, sold"
            maxLength={1000}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="Kept in"
          value={locationId}
          placeholder="Not recorded"
          onChange={(e) => {
            setLocationId(e.target.value);
            setSubLocationId("");
          }}
          options={locations.map((l) => ({ value: l.id, label: l.name }))}
        />
        {location && location.subLocations.length > 0 && (
          <Select
            label="Shelf or place"
            value={subLocationId}
            placeholder="Anywhere in it"
            onChange={(e) => setSubLocationId(e.target.value)}
            options={location.subLocations.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="type-group-title mb-3">Acquisition</legend>
        <CatalogueDateField
          label="Acquired"
          value={acquired}
          onChange={(value, err) => {
            setAcquired(value);
            setDateErrors((e) => ({ ...e, acquired: err }));
          }}
        />
        <div className="space-y-2">
          <SingleChoiceField
            label="Supplier"
            value={supplier}
            onChange={setSupplier}
            search={suppliers.search}
            onCreate={suppliers.create}
            placeholder="Search sellers..."
          />
          <SingleChoiceField
            label="Shop"
            value={venue}
            onChange={setVenue}
            search={searchShops}
            onCreate={createShop}
            placeholder="Search shops..."
          />
        </div>
        <div className="grid max-w-sm grid-cols-[1fr_6rem] gap-4">
          <Input
            label="Price"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
          />
          <Input
            label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="EUR"
            maxLength={3}
          />
        </div>
        {(price || currency) && priceError && (
          <p className="text-xs text-accent-red-text">{priceError}</p>
        )}
      </fieldset>

      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        maxLength={10000}
      />

      {error && (
        <p role="alert" className="text-sm text-accent-red-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" data-shortcut="save" onClick={save} disabled={blocked || saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          {bottle ? "Save" : `Add ${CONTAINER_LABELS[container].one.toLowerCase()}`}
        </Button>
      </div>
    </div>
  );
}
