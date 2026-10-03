"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ExternalLink, Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeading } from "@/components/shared/section-heading";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { CapAligned, CapAlignedControls } from "@/components/shared/cap-aligned";
import {
  addPerfumeRetailerLink,
  archivePerfumeRetailerLink,
  deletePerfumeRetailerLink,
  recordRetailerObservation,
} from "@/lib/actions/perfume-retailers";
import type { getPerfumeRetailerLinks } from "@/lib/actions/perfume-retailers";
import { RETAILER_AVAILABILITY } from "@/lib/catalogue/retailers";
import { PERFUME_CONTAINERS } from "@/lib/catalogue/perfumes";
import {
  CONTAINER_LABELS,
  formatPrice,
  formatVolume,
  type PerfumeContainer,
} from "@/lib/catalogue/perfume-labels";
import { SingleChoiceField, useOrganizationSearch } from "@/components/catalogue/record-fields";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";

type Listing = Awaited<ReturnType<typeof getPerfumeRetailerLinks>>[number];

const AVAILABILITY_LABELS: Record<(typeof RETAILER_AVAILABILITY)[number], string> = {
  unknown: "Availability unknown",
  in_stock: "In stock",
  out_of_stock: "Out of stock",
  preorder: "Pre-order",
  discontinued: "Discontinued",
  unlisted: "No longer listed",
};

function checkedText(listing: Listing) {
  if (listing.ageDays === null) return "No price recorded yet";
  const age =
    listing.ageDays === 0 ? "today" : listing.ageDays === 1 ? "yesterday" : `${listing.ageDays} days ago`;
  return `Checked ${age}${listing.isStale ? ", may have changed" : ""}`;
}

/**
 * Where the perfume is sold: a listing per retailer and address, with the
 * last price seen. A price is an observation on a day, never a promise that
 * it is still for sale.
 */
export function RetailersSection({
  perfumeId,
  perfumeTitle,
  listings,
  formulations,
}: {
  perfumeId: string;
  perfumeTitle: string;
  listings: Listing[];
  formulations: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    { kind: "add" } | { kind: "price" | "delete"; listing: Listing } | null
  >(null);
  const close = () => setDialog(null);
  const target = dialog && dialog.kind !== "add" ? dialog.listing : null;
  const formulationName = (id: string | null) =>
    id ? formulations.find((f) => f.id === id)?.label : null;

  return (
    <section className="mb-10" aria-labelledby="perfume-retailers">
      <SectionHeading
        id="perfume-retailers"
        title="Retailers"
        count={listings.length || undefined}
        action={
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "add" })}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Note a retailer
          </Button>
        }
      />
      {listings.length === 0 ? (
        <p className="text-sm text-fg-secondary">No retailers noted</p>
      ) : (
        <ul className="space-y-2">
          {listings.map((listing) => {
            const o = listing.observation;
            const offer = [
              o?.price != null && o.currency ? formatPrice(o.price, o.currency) : null,
              o?.container
                ? `${CONTAINER_LABELS[o.container as PerfumeContainer].one}${o.capacityMl ? ` ${formatVolume(o.capacityMl)}` : ""}`
                : null,
              o?.packageLabel ?? null,
              o ? AVAILABILITY_LABELS[o.availability] : null,
            ].filter(Boolean);
            return (
              <li
                key={listing.link.id}
                className="flex items-start gap-3 rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="type-item-title flex items-start gap-1.5">
                    <a
                      href={listing.link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-colors hover:text-accent-rose-text"
                    >
                      {listing.retailerName}
                      {listing.venueName ? `, ${listing.venueName}` : ""}
                    </a>
                    <CapAligned height={12}>
                      <ExternalLink className="h-3 w-3 text-fg-muted" strokeWidth={1.5} aria-hidden />
                    </CapAligned>
                  </p>
                  <p className="mt-0.5 text-sm text-fg-secondary">
                    {[formulationName(listing.link.variantId) ?? "Any formulation", ...offer].join(" · ")}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-secondary">{checkedText(listing)}</p>
                </div>
                <CapAlignedControls height={32} className="type-item-title">
                  <EntityActionMenu
                    items={[
                      { label: "Record a price", icon: Tag, onClick: () => setDialog({ kind: "price", listing }) },
                      {
                        label: "Archive",
                        icon: Archive,
                        onClick: async () => {
                          try {
                            await archivePerfumeRetailerLink(listing.link.id);
                            toast.success("Listing archived");
                            router.refresh();
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Could not archive");
                          }
                        },
                      },
                      { label: "Delete", icon: Trash2, onClick: () => setDialog({ kind: "delete", listing }), variant: "destructive" },
                    ]}
                  />
                </CapAlignedControls>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={dialog?.kind === "add"}
        onClose={close}
        title="Note a retailer"
        description={perfumeTitle}
        className="max-w-xl"
      >
        {dialog?.kind === "add" && (
          <ListingForm perfumeId={perfumeId} formulations={formulations} onDone={close} />
        )}
      </Dialog>
      <Dialog
        open={dialog?.kind === "price"}
        onClose={close}
        title="Record a price"
        description={target ? `${perfumeTitle}, ${target.retailerName}` : perfumeTitle}
        className="max-w-xl"
      >
        {dialog?.kind === "price" && <PriceForm linkId={dialog.listing.link.id} onDone={close} />}
      </Dialog>
      <ConfirmDeleteDialog
        open={dialog?.kind === "delete"}
        onClose={close}
        title="Delete listing"
        name={target ? target.retailerName : ""}
        description="A listing with recorded prices stays as history: archive it instead. A listing without prices can be deleted."
        onConfirm={async () => {
          if (!target) return;
          try {
            await deletePerfumeRetailerLink(target.link.id);
            toast.success("Listing deleted");
            close();
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete");
          }
        }}
      />
    </section>
  );
}

function ListingForm({
  perfumeId,
  formulations,
  onDone,
}: {
  perfumeId: string;
  formulations: { id: string; label: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const retailers = useOrganizationSearch("retailer");
  const [retailer, setRetailer] = useState<{ id: string; label: string } | null>(null);
  const [variantId, setVariantId] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const validUrl = /^https?:\/\/[^\s@/]+/.test(url.trim());
  return (
    <div className="space-y-4">
      <SingleChoiceField
        label="Retailer"
        value={retailer}
        onChange={setRetailer}
        search={retailers.search}
        onCreate={retailers.create}
        placeholder="Search sellers..."
      />
      <Select
        label="Formulation"
        value={variantId}
        placeholder="Any formulation"
        onChange={(e) => setVariantId(e.target.value)}
        options={formulations.map((f) => ({ value: f.id, label: f.label }))}
      />
      <Input
        label="Address of the listing"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://"
        maxLength={4000}
        error={url && !validUrl ? "Enter an address that starts with http:// or https://" : undefined}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          data-shortcut="save"
          disabled={!retailer || !validUrl || saving}
          onClick={async () => {
            if (!retailer) return;
            setSaving(true);
            try {
              await addPerfumeRetailerLink({
                workId: perfumeId,
                variantId: variantId || null,
                organizationId: retailer.id,
                url: url.trim(),
              });
              toast.success("Retailer noted");
              onDone();
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not note the retailer");
              setSaving(false);
            }
          }}
        >
          Note retailer
        </Button>
      </div>
    </div>
  );
}

/** Today in the browser's calendar, as YYYY-MM-DD */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function PriceForm({ linkId, onDone }: { linkId: string; onDone: () => void }) {
  const router = useRouter();
  const [day, setDay] = useState(today());
  const [availability, setAvailability] = useState<(typeof RETAILER_AVAILABILITY)[number]>("in_stock");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [container, setContainer] = useState("");
  const [capacity, setCapacity] = useState("");
  const [packageLabel, setPackageLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const priceValue = price.trim() ? Number(price.replace(",", ".")) : null;
  const capacityValue = capacity.trim() ? Number(capacity.replace(",", ".")) : null;
  const error =
    priceValue !== null && (!Number.isFinite(priceValue) || priceValue < 0)
      ? "Enter a price of 0 or more"
      : (priceValue === null) !== !currency.trim()
        ? "A price needs its currency, and a currency its price"
        : currency.trim() && !/^[A-Z]{3}$/.test(currency)
          ? "Use a three-letter code: EUR, GBP, USD"
          : capacityValue !== null && (!Number.isFinite(capacityValue) || capacityValue <= 0)
            ? "Enter a size above 0"
            : capacityValue !== null && !container
              ? "Choose what the size is of"
              : !day || day > today()
                ? "Choose a day, today or before"
                : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Seen on" type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
        <Select
          label="Availability"
          value={availability}
          onChange={(e) => setAvailability(e.target.value as typeof availability)}
          options={RETAILER_AVAILABILITY.map((a) => ({ value: a, label: AVAILABILITY_LABELS[a] }))}
        />
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-4">
        <Input label="Price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        <Input label="Currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="EUR" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Select
          label="Of a"
          value={container}
          placeholder="Not stated"
          onChange={(e) => setContainer(e.target.value)}
          options={PERFUME_CONTAINERS.map((c) => ({ value: c, label: CONTAINER_LABELS[c].one }))}
        />
        <Input label="Size (ml)" inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        <Input label="Package" value={packageLabel} maxLength={500} onChange={(e) => setPackageLabel(e.target.value)} placeholder="Gift set" />
      </div>
      <Textarea label="Notes" value={notes} rows={2} maxLength={10000} onChange={(e) => setNotes(e.target.value)} />
      {error && (price || currency || capacity) && <p className="text-xs text-accent-red-text">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          data-shortcut="save"
          disabled={!!error || saving}
          onClick={async () => {
            setSaving(true);
            try {
              // Today: now; another day: its middle, never later than now
              const checkedAt = day === today() ? new Date().toISOString() : `${day}T12:00:00.000Z`;
              await recordRetailerObservation({
                linkId,
                checkedAt,
                availability,
                price: priceValue,
                currency: currency.trim() || null,
                container: (container || null) as PerfumeContainer | null,
                capacityMl: capacityValue,
                packageLabel: packageLabel.trim() || null,
                notes: notes.trim() || null,
              });
              toast.success("Price recorded");
              onDone();
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not record the price");
              setSaving(false);
            }
          }}
        >
          Record price
        </Button>
      </div>
    </div>
  );
}
