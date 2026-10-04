"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import {
  SingleChoiceField,
  useOrganizationSearch,
} from "@/components/catalogue/record-fields";
import type { PickerChoice } from "@/components/catalogue/search-picker";
import {
  DisposalFields,
  StorageFields,
  numberText,
  priceError,
  readNumber,
  type StorageLocation,
} from "@/components/catalogue/holding-fields";
import { createArtObject, updateArtObject } from "@/lib/actions/paintings";
import { createVenue, searchVenues } from "@/lib/actions/venues";
import {
  ART_OBJECT_KINDS,
  ART_OWNERSHIPS,
  DIMENSION_UNITS,
} from "@/lib/catalogue/paintings";
import {
  HOLDING_STATUS_LABELS,
  PERSONAL_HOLDING_STATUSES,
  type HoldingStatus,
} from "@/lib/catalogue/holdings";
import {
  ART_OBJECT_KIND_LABELS,
  OWNERSHIP_LABELS,
  type ArtObjectKind,
  type ArtOwnership,
  type DimensionUnit,
} from "@/lib/catalogue/painting-labels";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import { painterInput, type PainterEntry } from "@/lib/catalogue/painting-labels";
import { PaintersField } from "./painting-fields";

/** A stored object, as the edit dialog starts from it */
export interface EditableArtObject {
  id: string;
  fingerprint: string;
  kind: ArtObjectKind;
  label: string | null;
  reproducesObjectId: string | null;
  creationDate: CatalogueDateInput | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  dimensionUnit: DimensionUnit | null;
  dimensionsNote: string | null;
  /** null: the painting's painters */
  attribution: PainterEntry[] | null;
  ownership: ArtOwnership;
  owner: { id: string; label: string } | null;
  ownerLabel: string | null;
  collectionName: string | null;
  accessionNumber: string | null;
  holdingStatus: HoldingStatus | null;
  locationId: string | null;
  subLocationId: string | null;
  acquisitionDate: CatalogueDateInput | null;
  venue: { id: string; label: string } | null;
  acquisitionPrice: number | null;
  acquisitionCurrency: string | null;
  dispositionDate: CatalogueDateInput | null;
  dispositionReason: string | null;
  notes: string | null;
}

/** An original or version a reproduction can name */
export interface ReproducibleObject {
  id: string;
  label: string;
}

/**
 * Adds or edits one physical object of the painting: the original, a
 * version by the artist or workshop, or a reproduction (a print, a copy, a
 * poster), which never replaces the original. Who owns it is stated apart
 * from where it is: a museum, a private collection, you, or unknown.
 */
export function ArtObjectDialog({
  open,
  onClose,
  paintingId,
  paintingTitle,
  object,
  initialKind,
  originals,
  locations,
}: {
  open: boolean;
  onClose: () => void;
  paintingId: string;
  paintingTitle: string;
  object?: EditableArtObject;
  initialKind?: ArtObjectKind;
  originals: ReproducibleObject[];
  locations: StorageLocation[];
}) {
  const kind = object?.kind ?? initialKind ?? "original";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={object ? `Edit ${ART_OBJECT_KIND_LABELS[kind].toLowerCase()}` : `Add ${kind === "reproduction" ? "a reproduction" : kind === "version" ? "a version" : "the original"}`}
      description={paintingTitle}
      className="max-w-3xl"
    >
      {open && (
        <ArtObjectForm
          paintingId={paintingId}
          object={object}
          initialKind={kind}
          originals={originals.filter((o) => o.id !== object?.id)}
          locations={locations}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
}

function ArtObjectForm({
  paintingId,
  object,
  initialKind,
  originals,
  locations,
  onDone,
}: {
  paintingId: string;
  object?: EditableArtObject;
  initialKind: ArtObjectKind;
  originals: ReproducibleObject[];
  locations: StorageLocation[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ArtObjectKind>(initialKind);
  const [label, setLabel] = useState(object?.label ?? "");
  const [reproduces, setReproduces] = useState(object?.reproducesObjectId ?? "");
  const [created, setCreated] = useState(object?.creationDate ?? null);
  const [height, setHeight] = useState(numberText(object?.height));
  const [width, setWidth] = useState(numberText(object?.width));
  const [depth, setDepth] = useState(numberText(object?.depth));
  const [unit, setUnit] = useState<DimensionUnit>(object?.dimensionUnit ?? "cm");
  const [dimensionsNote, setDimensionsNote] = useState(object?.dimensionsNote ?? "");
  const [ownHands, setOwnHands] = useState(object?.attribution != null);
  const [hands, setHands] = useState<PainterEntry[]>(object?.attribution ?? []);
  const [ownership, setOwnership] = useState<ArtOwnership>(
    object?.ownership ?? (initialKind === "reproduction" ? "personal" : "unknown"),
  );
  const [owner, setOwner] = useState(object?.owner ?? null);
  const [ownerLabel, setOwnerLabel] = useState(object?.ownerLabel ?? "");
  const [collectionName, setCollectionName] = useState(object?.collectionName ?? "");
  const [accession, setAccession] = useState(object?.accessionNumber ?? "");
  const [status, setStatus] = useState<HoldingStatus>(object?.holdingStatus ?? "held");
  const [locationId, setLocationId] = useState(object?.locationId ?? "");
  const [subLocationId, setSubLocationId] = useState(object?.subLocationId ?? "");
  const [acquired, setAcquired] = useState(object?.acquisitionDate ?? null);
  const [shop, setShop] = useState(object?.venue ?? null);
  const [price, setPrice] = useState(numberText(object?.acquisitionPrice));
  const [currency, setCurrency] = useState(object?.acquisitionCurrency ?? "");
  const [disposed, setDisposed] = useState(object?.dispositionDate ?? null);
  const [reason, setReason] = useState(object?.dispositionReason ?? "");
  const [notes, setNotes] = useState(object?.notes ?? "");
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Any organization can own a painting: the owner search is not filtered
  const institutions = useOrganizationSearch("museum");
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
    const created = await createVenue({ name, type: "gallery" });
    return { id: created.id, label: created.name };
  }, []);

  const sides = [height, width, depth].map(readNumber);
  const measured = sides.some((side) => side !== null);
  const badSide = sides.some((side) => side !== null && (!Number.isFinite(side) || side <= 0));
  const personal = ownership === "personal";
  const moneyError = personal ? priceError(price, currency) : null;
  const blocked =
    badSide ||
    (ownership === "institutional" && !owner) ||
    !!moneyError ||
    Object.values(dateErrors).some(Boolean) ||
    saving;

  async function save() {
    if (blocked) return;
    setSaving(true);
    setError(null);
    const isDisposed = personal && status === "disposed";
    const fields = {
      kind,
      label: label.trim() || null,
      reproducesObjectId: kind === "reproduction" ? reproduces || null : null,
      creationDate: created,
      height: sides[0],
      width: sides[1],
      depth: sides[2],
      dimensionUnit: measured ? unit : null,
      dimensionsNote: dimensionsNote.trim() || null,
      attribution: ownHands ? painterInput(hands).map(({ roleId: _role, ...c }) => c) : null,
      ownership,
      ownerOrganizationId: ownership === "institutional" ? (owner?.id ?? null) : null,
      ownerLabel: ownership === "private" ? ownerLabel.trim() || null : null,
      collectionName: ownership === "institutional" ? collectionName.trim() || null : null,
      accessionNumber: ownership === "institutional" ? accession.trim() || null : null,
      holdingStatus: personal ? status : null,
      locationId: personal ? locationId || null : null,
      subLocationId: personal ? (locationId && subLocationId) || null : null,
      acquisitionDate: personal ? acquired : null,
      venueId: personal ? (shop?.id ?? null) : null,
      acquisitionPrice: personal ? readNumber(price) : null,
      acquisitionCurrency: personal ? currency.trim() || null : null,
      dispositionDate: isDisposed ? disposed : null,
      dispositionReason: isDisposed ? reason.trim() || null : null,
      notes: notes.trim() || null,
    };
    try {
      if (object) await updateArtObject(object.id, fields, object.fingerprint);
      else await createArtObject({ workId: paintingId, ...fields });
      toast.success(object ? "Object saved" : "Object added");
      onDone();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the object";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="type-label mb-1.5">What it is</legend>
        <SegmentedControl
          ariaLabel="What it is"
          options={ART_OBJECT_KINDS.map((k) => ({ value: k, label: ART_OBJECT_KIND_LABELS[k] }))}
          value={kind}
          onChange={(next) => {
            setKind(next);
            if (next !== "reproduction") setReproduces("");
          }}
        />
        <p className="text-xs text-fg-secondary">
          {kind === "reproduction"
            ? "A print, copy or poster of the painting. It never stands in for the original."
            : kind === "version"
              ? "Another version by the artist or the workshop, such as a second painting of the subject."
              : "The painting itself, as the artist made it."}
        </p>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={kind === "reproduction" ? "Giclée print, museum poster" : "Second version"}
          maxLength={200}
        />
        {kind === "reproduction" && originals.length > 0 && (
          <Select
            label="Reproduces"
            value={reproduces}
            placeholder="The painting in general"
            onChange={(e) => setReproduces(e.target.value)}
            options={originals.map((o) => ({ value: o.id, label: o.label }))}
          />
        )}
      </div>

      <div className="max-w-md">
        <CatalogueDateField
          label={kind === "reproduction" ? "Printed or made" : "Painted"}
          value={created}
          onChange={(value, err) => {
            setCreated(value);
            setDateErrors((e) => ({ ...e, created: err }));
          }}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="type-group-title mb-3">Size</legend>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Input label="Height" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} />
          <Input label="Width" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} />
          <Input label="Depth" inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)} />
          <Select
            label="Unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as DimensionUnit)}
            options={DIMENSION_UNITS.map((u) => ({ value: u, label: u }))}
          />
        </div>
        {badSide && <p className="text-xs text-accent-red-text">Enter sizes above 0</p>}
        <Input
          label="About the size"
          value={dimensionsNote}
          onChange={(e) => setDimensionsNote(e.target.value)}
          placeholder="Sight size; with frame 95 × 120 cm"
          maxLength={500}
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="type-group-title mb-3">Hand</legend>
        <label className="flex items-center gap-3 text-sm text-fg-primary">
          <Switch checked={ownHands} onCheckedChange={setOwnHands} aria-label="Its own attribution" />
          Its own attribution, not the painting&apos;s painters
        </label>
        {ownHands && <PaintersField label="Painted by" value={hands} onChange={setHands} />}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="type-group-title mb-3">Owner</legend>
        <Select
          label="Owned by"
          value={ownership}
          onChange={(e) => setOwnership(e.target.value as ArtOwnership)}
          options={ART_OWNERSHIPS.map((o) => ({ value: o, label: OWNERSHIP_LABELS[o] }))}
        />
        {ownership === "institutional" && (
          <>
            <SingleChoiceField
              label="Institution"
              value={owner}
              onChange={setOwner}
              search={institutions.search}
              onCreate={institutions.create}
              placeholder="Search museums..."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Collection"
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                placeholder="Lillie P. Bliss Bequest"
                maxLength={300}
              />
              <Input
                label="Accession number"
                value={accession}
                onChange={(e) => setAccession(e.target.value)}
                placeholder="472.1941"
                maxLength={200}
              />
            </div>
          </>
        )}
        {ownership === "private" && (
          <Input
            label="Which collection"
            value={ownerLabel}
            onChange={(e) => setOwnerLabel(e.target.value)}
            placeholder="Zürich; the artist's heirs"
            maxLength={300}
          />
        )}
        {personal && (
          <>
            <Select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as HoldingStatus)}
              options={PERSONAL_HOLDING_STATUSES.map((s) => ({ value: s, label: HOLDING_STATUS_LABELS[s] }))}
            />
            {status === "disposed" && (
              <DisposalFields
                disposed={disposed}
                reason={reason}
                onDisposed={(value, err) => {
                  setDisposed(value);
                  setDateErrors((e) => ({ ...e, disposed: err }));
                }}
                onReason={setReason}
                reasonPlaceholder="Sold, given away"
              />
            )}
            <StorageFields
              locations={locations}
              locationId={locationId}
              subLocationId={subLocationId}
              onLocation={(id) => {
                setLocationId(id);
                setSubLocationId("");
              }}
              onSubLocation={setSubLocationId}
            />
            <CatalogueDateField
              label="Acquired"
              value={acquired}
              onChange={(value, err) => {
                setAcquired(value);
                setDateErrors((e) => ({ ...e, acquired: err }));
              }}
            />
            <SingleChoiceField
              label="Bought at"
              value={shop}
              onChange={setShop}
              search={searchShops}
              onCreate={createShop}
              placeholder="Search galleries and shops..."
            />
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
            {(price || currency) && moneyError && (
              <p className="text-xs text-accent-red-text">{moneyError}</p>
            )}
          </>
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
        <Button variant="primary" data-shortcut="save" onClick={save} disabled={blocked}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          {object ? "Save" : "Add"}
        </Button>
      </div>
    </div>
  );
}
