"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { StorageFields, priceError, readNumber, type StorageLocation } from "@/components/catalogue/holding-fields";
import { SingleChoiceField } from "@/components/catalogue/record-fields";
import type { PickerChoice } from "@/components/catalogue/search-picker";
import { createTypedTarget, orderTypedTarget, removeTypedTarget, type TypedTargetView } from "@/lib/actions/acquisitions";
import { searchVenues } from "@/lib/actions/venues";
import {
  ACQUISITION_METHOD_LABELS,
  ORDER_STATUS_LABELS,
  TARGET_STATE_LABELS,
} from "@/lib/catalogue/acquisition-labels";
import { CONTAINER_LABELS } from "@/lib/catalogue/perfume-labels";
import { FILM_MEDIUM_LABELS } from "@/lib/catalogue/film-labels";
import { PERFUME_CONTAINERS } from "@/lib/catalogue/perfumes";
import { FILM_HOLDING_MEDIA } from "@/lib/catalogue/films";
import { getValidInitialStatuses, type AcquisitionMethod, type OrderStatus } from "@/lib/constants/orders";
import { todayLocal } from "@/lib/utils/date";

/** "Oct 4, 2026", as a copy's acquisition date reads */
const orderDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayText = (day: string) => orderDay.format(new Date(`${day}T00:00:00Z`));

/** What can be wanted of this work: its formulations, versions or objects */
export type WantedChoices =
  | { kind: "perfume"; formulations: { id: string; label: string }[] }
  | { kind: "film"; versions: { id: string; label: string; releases: { id: string; label: string }[] }[] }
  | {
      kind: "painting";
      /** Objects in private or unknown hands can be bought; any original or version reproduced */
      objects: { id: string; label: string; forSale: boolean; reproducible: boolean }[];
    };

/**
 * What the collector wants to buy of this film, perfume or painting, and the
 * orders that buy it. A received order brings in its bottle, copy or object;
 * its later steps are tracked in Provenance.
 */
export function WantedSection({
  workId,
  title,
  targets,
  choices,
  locations,
}: {
  workId: string;
  title: string;
  targets: TypedTargetView[];
  choices: WantedChoices;
  /** Where an order can arrive: physical places, and digital ones for films */
  locations: { physical: StorageLocation[]; digital: StorageLocation[] };
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ kind: "add" } | { kind: "order"; target: TypedTargetView } | null>(null);
  const close = () => setDialog(null);
  const canAdd =
    choices.kind === "perfume"
      ? choices.formulations.length > 0
      : choices.kind === "film"
        ? choices.versions.length > 0
        : choices.objects.some((o) => o.forSale || o.reproducible);
  const missing =
    choices.kind === "perfume"
      ? "A wish names a formulation. Add a formulation first, even one of unknown concentration."
      : choices.kind === "film"
        ? "A wish names a version. Add a version first."
        : "A wish names an original or a version. Record one first.";

  async function remove(target: TypedTargetView) {
    try {
      await removeTypedTarget(target.id);
      toast.success("Removed from your list");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove");
    }
  }

  return (
    <section className="mb-10" aria-labelledby={`${choices.kind}-wanted`}>
      <SectionHeading
        id={`${choices.kind}-wanted`}
        title="Wanted"
        count={targets.length || undefined}
        action={
          canAdd && (
            <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "add" })}>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Add
            </Button>
          )
        }
      />
      {!canAdd ? (
        <p className="max-w-xl text-sm text-fg-secondary">{missing}</p>
      ) : targets.length === 0 ? (
        <p className="text-sm text-fg-secondary">Nothing on your list</p>
      ) : (
        <ul className="space-y-2">
          {targets.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-3 rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="type-item-title">{t.title}</p>
                <p className="mt-0.5 text-sm text-fg-secondary">{TARGET_STATE_LABELS[t.state]}</p>
                {t.orders.map((o) => (
                  <p key={o.id} className="mt-0.5 text-xs text-fg-secondary">
                    {[
                      `${ORDER_STATUS_LABELS[o.status] ?? o.status} · ordered ${dayText(o.orderDate)}`,
                      o.cost,
                      o.received ? "in the collection" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {" · "}
                    <Link href="/provenance" className="underline-offset-2 hover:text-fg-primary hover:underline">
                      Provenance
                    </Link>
                  </p>
                ))}
              </div>
              <CapAlignedControls height={32} className="type-item-title">
                <EntityActionMenu
                  items={[
                    ...(t.state === "received"
                      ? []
                      : [{ label: "Order", icon: ShoppingBag, onClick: () => setDialog({ kind: "order", target: t }) }]),
                    { label: "Remove", icon: Trash2, onClick: () => remove(t), variant: "destructive" as const },
                  ]}
                />
              </CapAlignedControls>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialog?.kind === "add"} onClose={close} title="Add to your list" description={title} className="max-w-2xl">
        {dialog?.kind === "add" && <WantForm workId={workId} choices={choices} onDone={close} />}
      </Dialog>
      <Dialog
        open={dialog?.kind === "order"}
        onClose={close}
        title="Order"
        description={dialog?.kind === "order" ? `${title}: ${dialog.target.title}` : title}
        className="max-w-2xl"
      >
        {dialog?.kind === "order" && (
          <OrderForm
            target={dialog.target}
            locations={dialog.target.medium === "digital" ? locations.digital : locations.physical}
            onDone={close}
          />
        )}
      </Dialog>
    </section>
  );
}

/** The kinds of container, as choices in a row */
function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="type-label mb-1.5">{label}</legend>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`h-8 pointer-coarse:h-11 rounded-sm border px-3 text-sm transition-colors ${
              value === o.value
                ? "border-accent-primary/40 bg-selection-bg text-fg-primary"
                : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FormFooter({ saving, error, blocked, label, onCancel, onSave }: {
  saving: boolean;
  error: string | null;
  blocked: boolean;
  label: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-accent-red-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" data-shortcut="save" onClick={onSave} disabled={blocked || saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          {label}
        </Button>
      </div>
    </>
  );
}

/** A wish: the formulation and size, the version and medium, or the object */
function WantForm({ workId, choices, onDone }: { workId: string; choices: WantedChoices; onDone: () => void }) {
  const router = useRouter();
  const [variantId, setVariantId] = useState(choices.kind === "perfume" ? (choices.formulations[0]?.id ?? "") : "");
  const [container, setContainer] = useState<(typeof PERFUME_CONTAINERS)[number]>("bottle");
  const [capacity, setCapacity] = useState("");
  const [unit, setUnit] = useState<"ml" | "l">("ml");
  const [versionId, setVersionId] = useState(choices.kind === "film" ? (choices.versions[0]?.id ?? "") : "");
  const [releaseId, setReleaseId] = useState("");
  const [medium, setMedium] = useState<(typeof FILM_HOLDING_MEDIA)[number]>("physical");
  const [formatLabel, setFormatLabel] = useState("");
  const paintingOptions =
    choices.kind === "painting"
      ? [
          ...choices.objects.filter((o) => o.forSale).map((o) => ({ value: `object:${o.id}`, label: o.label })),
          ...choices.objects
            .filter((o) => o.reproducible)
            .map((o) => ({ value: `reproduction:${o.id}`, label: `A reproduction of ${o.label.charAt(0).toLowerCase()}${o.label.slice(1)}` })),
        ]
      : [];
  const [objectChoice, setObjectChoice] = useState(paintingOptions[0]?.value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capacityValue = readNumber(capacity);
  const capacityError =
    capacityValue === null ? "Enter the size" : !Number.isFinite(capacityValue) || capacityValue <= 0 ? "Enter a size above 0" : null;
  const blocked =
    choices.kind === "perfume" ? !variantId || !!capacityError : choices.kind === "film" ? !versionId : !objectChoice;
  const releases = choices.kind === "film" ? (choices.versions.find((v) => v.id === versionId)?.releases ?? []) : [];

  async function save() {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (choices.kind === "perfume")
        await createTypedTarget({ kind: "perfume", workId, variantId, container, capacityValue: capacityValue!, volumeUnit: unit });
      else if (choices.kind === "film")
        await createTypedTarget({
          kind: "film",
          workId,
          versionId,
          releaseId: releaseId || null,
          medium,
          formatLabel: formatLabel.trim() || null,
        });
      else {
        const [how, objectId] = objectChoice.split(":");
        await createTypedTarget({ kind: "painting", workId, objectId, reproduction: how === "reproduction" });
      }
      toast.success("Added to your list");
      onDone();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not add";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {choices.kind === "perfume" && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Formulation"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              options={choices.formulations.map((f) => ({ value: f.id, label: f.label }))}
            />
            <ChoiceRow
              label="Kind"
              value={container}
              onChange={setContainer}
              options={PERFUME_CONTAINERS.map((k) => ({ value: k, label: CONTAINER_LABELS[k].one }))}
            />
          </div>
          <div className="grid max-w-sm grid-cols-[1fr_6rem] gap-4">
            <Input
              label="Size"
              inputMode="decimal"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="50"
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
          </div>
        </>
      )}
      {choices.kind === "film" && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Version"
              value={versionId}
              onChange={(e) => {
                setVersionId(e.target.value);
                setReleaseId("");
              }}
              options={choices.versions.map((v) => ({ value: v.id, label: v.label }))}
            />
            <Select
              label="Release"
              value={releaseId}
              placeholder="Any release"
              onChange={(e) => setReleaseId(e.target.value)}
              options={releases.map((r) => ({ value: r.id, label: r.label }))}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <ChoiceRow
              label="Medium"
              value={medium}
              onChange={setMedium}
              options={FILM_HOLDING_MEDIA.map((m) => ({ value: m, label: FILM_MEDIUM_LABELS[m] }))}
            />
            <Input
              label="Format"
              value={formatLabel}
              onChange={(e) => setFormatLabel(e.target.value)}
              placeholder={medium === "digital" ? "MKV file" : "Blu-ray"}
              maxLength={200}
            />
          </div>
        </>
      )}
      {choices.kind === "painting" && (
        <Select
          label="What to buy"
          value={objectChoice}
          onChange={(e) => setObjectChoice(e.target.value)}
          options={paintingOptions}
        />
      )}
      <FormFooter saving={saving} error={error} blocked={blocked} label="Add to list" onCancel={onDone} onSave={save} />
    </div>
  );
}

/**
 * An order for a wish: how and when, for how much, where it will be kept.
 * Bought in a shop or given, it arrives at once.
 */
function OrderForm({ target, locations, onDone }: { target: TypedTargetView; locations: StorageLocation[]; onDone: () => void }) {
  const router = useRouter();
  const [method, setMethod] = useState<AcquisitionMethod>("online_order");
  const [status, setStatus] = useState<OrderStatus>("placed");
  const [orderDate, setOrderDate] = useState(todayLocal());
  const [price, setPrice] = useState("");
  const [shipping, setShipping] = useState("");
  const [currency, setCurrency] = useState("");
  const [venue, setVenue] = useState<{ id: string; label: string } | null>(null);
  const [locationId, setLocationId] = useState("");
  const [subLocationId, setSubLocationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchShops = useCallback(
    async (query: string): Promise<PickerChoice[]> =>
      (await searchVenues(query)).map((v) => ({ id: v.id, label: v.name, hint: v.place?.name ?? null })),
    [],
  );
  const statuses = getValidInitialStatuses(method);
  const moneyError = priceError(price, currency) ?? (shipping && priceError(shipping, currency));
  const blocked = !orderDate || !!moneyError;
  const arrivesNow = status === "purchased" || status === "received" || status === "delivered";

  async function save() {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    const p = readNumber(price);
    const s = readNumber(shipping);
    const total = p !== null || s !== null ? ((p ?? 0) + (s ?? 0)).toFixed(2) : null;
    try {
      await orderTypedTarget({
        targetId: target.id,
        acquisitionMethod: method,
        status,
        orderDate,
        price: p !== null ? p.toFixed(2) : null,
        shippingCost: s !== null ? s.toFixed(2) : null,
        totalCost: total,
        currency: currency.trim() || null,
        venueId: venue?.id ?? null,
        destinationLocationId: locationId || null,
        destinationSubLocationId: (locationId && subLocationId) || null,
      });
      toast.success(arrivesNow ? "Ordered, and in the collection" : "Ordered");
      onDone();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not order";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="How"
          value={method}
          onChange={(e) => {
            const next = e.target.value as AcquisitionMethod;
            setMethod(next);
            setStatus(getValidInitialStatuses(next)[0]);
          }}
          options={Object.entries(ACQUISITION_METHOD_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as OrderStatus)}
          options={statuses.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] ?? s }))}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <DatePicker label="Ordered on" value={orderDate} onChange={setOrderDate} required />
        <SingleChoiceField label="Shop" value={venue} onChange={setVenue} search={searchShops} placeholder="Search shops..." />
      </div>
      <div className="grid max-w-md grid-cols-[1fr_1fr_6rem] gap-4">
        <Input label="Price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        <Input label="Shipping" inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0.00" />
        <Input
          label="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          placeholder="EUR"
          maxLength={3}
        />
      </div>
      {(price || shipping || currency) && moneyError && <p className="text-xs text-accent-red-text">{moneyError}</p>}
      <StorageFields
        locations={locations}
        locationId={locationId}
        subLocationId={subLocationId}
        onLocation={(id) => {
          setLocationId(id);
          setSubLocationId("");
        }}
        onSubLocation={setSubLocationId}
        placeholder="Decide when it arrives"
      />
      <FormFooter saving={saving} error={error} blocked={blocked} label="Order" onCancel={onDone} onSave={save} />
    </div>
  );
}
