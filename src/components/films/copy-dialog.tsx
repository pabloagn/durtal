"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AcquisitionFields,
  DisposalFields,
  StorageFields,
  numberText,
  priceError,
  readNumber,
  type AcquisitionDraft,
  type StorageLocation,
} from "@/components/catalogue/holding-fields";
import { addFilmHolding, updateFilmHolding } from "@/lib/actions/films";
import { FILM_HOLDING_MEDIA } from "@/lib/catalogue/films";
import { PERSONAL_HOLDING_STATUSES } from "@/lib/catalogue/holdings";
import {
  FILM_MEDIUM_LABELS,
  HOLDING_STATUS_LABELS,
  type FilmMedium,
  type HoldingStatus,
} from "@/lib/catalogue/film-labels";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";

/** A storage place and the kind of copy it can hold */
export interface CopyLocation extends StorageLocation {
  type: FilmMedium;
}

/** The versions a copy can reproduce, with their releases */
export interface VersionChoice {
  id: string;
  label: string;
  releases: { id: string; label: string }[];
}

/** A stored copy, as the edit dialog starts from it */
export interface EditableCopy {
  id: string;
  fingerprint: string;
  versionId: string | null;
  releaseId: string | null;
  medium: FilmMedium;
  formatLabel: string | null;
  status: HoldingStatus;
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

/**
 * Adds or edits a personal copy: a disc, print or tape, or a digital file;
 * the version and release it reproduces when known, where it is kept, how
 * and when it came, and how it went. Watching or rating a film never needs
 * a copy.
 */
export function CopyDialog({
  open,
  onClose,
  filmId,
  filmTitle,
  versions,
  locations,
  copy,
  initialVersionId,
}: {
  open: boolean;
  onClose: () => void;
  filmId: string;
  filmTitle: string;
  versions: VersionChoice[];
  locations: CopyLocation[];
  copy?: EditableCopy;
  initialVersionId?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy ? "Edit copy" : "Add copy"}
      description={filmTitle}
      className="max-w-3xl"
    >
      {open && (
        <CopyForm
          filmId={filmId}
          versions={versions}
          locations={locations}
          copy={copy}
          initialVersionId={initialVersionId}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
}

function CopyForm({
  filmId,
  versions,
  locations,
  copy,
  initialVersionId,
  onDone,
}: {
  filmId: string;
  versions: VersionChoice[];
  locations: CopyLocation[];
  copy?: EditableCopy;
  initialVersionId?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [medium, setMedium] = useState<FilmMedium>(copy?.medium ?? "physical");
  const [versionId, setVersionId] = useState(copy?.versionId ?? initialVersionId ?? "");
  const [releaseId, setReleaseId] = useState(copy?.releaseId ?? "");
  const [formatLabel, setFormatLabel] = useState(copy?.formatLabel ?? "");
  const [status, setStatus] = useState<HoldingStatus>(copy?.status ?? "held");
  const [condition, setCondition] = useState(copy?.condition ?? "");
  const [locationId, setLocationId] = useState(copy?.locationId ?? "");
  const [subLocationId, setSubLocationId] = useState(copy?.subLocationId ?? "");
  const [acquisition, setAcquisition] = useState<AcquisitionDraft>({
    acquired: copy?.acquisitionDate ?? null,
    supplier: copy?.supplier ?? null,
    venue: copy?.venue ?? null,
    price: numberText(copy?.acquisitionPrice),
    currency: copy?.acquisitionCurrency ?? "",
  });
  const [disposed, setDisposed] = useState(copy?.dispositionDate ?? null);
  const [reason, setReason] = useState(copy?.dispositionReason ?? "");
  const [notes, setNotes] = useState(copy?.notes ?? "");
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const places = locations.filter((l) => l.type === medium);
  const releases = versions.find((v) => v.id === versionId)?.releases ?? [];
  const blocked =
    !!priceError(acquisition.price, acquisition.currency) ||
    Object.values(dateErrors).some(Boolean) ||
    saving;

  async function save() {
    if (blocked) return;
    setSaving(true);
    setError(null);
    const isDisposed = status === "disposed";
    const fields = {
      versionId: versionId || null,
      releaseId: (versionId && releaseId) || null,
      medium,
      formatLabel: formatLabel.trim() || null,
      status,
      condition: condition.trim() || null,
      locationId: locationId || null,
      subLocationId: (locationId && subLocationId) || null,
      acquisitionDate: acquisition.acquired,
      supplierId: acquisition.supplier?.id ?? null,
      venueId: acquisition.venue?.id ?? null,
      acquisitionPrice: readNumber(acquisition.price),
      acquisitionCurrency: acquisition.currency.trim() || null,
      dispositionDate: isDisposed ? disposed : null,
      dispositionReason: isDisposed ? reason.trim() || null : null,
      notes: notes.trim() || null,
    };
    try {
      if (copy) await updateFilmHolding(copy.id, fields, copy.fingerprint);
      else await addFilmHolding({ workId: filmId, ...fields });
      toast.success(copy ? "Copy saved" : "Copy added");
      onDone();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the copy";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset>
          <legend className="type-label mb-1.5">Kind</legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Kind">
            {FILM_HOLDING_MEDIA.map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={medium === kind}
                onClick={() => {
                  setMedium(kind);
                  // A physical copy is kept in a physical place, a file on a digital one
                  if (!locations.some((l) => l.id === locationId && l.type === kind)) {
                    setLocationId("");
                    setSubLocationId("");
                  }
                }}
                className={`h-8 pointer-coarse:h-11 rounded-sm border px-3 text-sm transition-colors ${
                  medium === kind
                    ? "border-accent-primary/40 bg-selection-bg text-fg-primary"
                    : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
                }`}
              >
                {FILM_MEDIUM_LABELS[kind]}
              </button>
            ))}
          </div>
        </fieldset>
        <Input
          label="Format"
          value={formatLabel}
          onChange={(e) => setFormatLabel(e.target.value)}
          placeholder={medium === "physical" ? "Blu-ray, DVD, 35 mm print" : "MKV file, ProRes"}
          maxLength={200}
        />
      </div>

      {versions.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Version"
            value={versionId}
            placeholder="Not recorded"
            onChange={(e) => {
              setVersionId(e.target.value);
              setReleaseId("");
            }}
            options={versions.map((v) => ({ value: v.id, label: v.label }))}
          />
          {releases.length > 0 && (
            <Select
              label="Release"
              value={releaseId}
              placeholder="Not recorded"
              onChange={(e) => setReleaseId(e.target.value)}
              options={releases.map((r) => ({ value: r.id, label: r.label }))}
            />
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as HoldingStatus)}
          options={PERSONAL_HOLDING_STATUSES.map((s) => ({ value: s, label: HOLDING_STATUS_LABELS[s] }))}
        />
        <Input
          label="Condition"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder={medium === "physical" ? "Sealed, slipcover, scratched" : "Remux, 1080p"}
          maxLength={300}
        />
      </div>

      {status === "disposed" && (
        <DisposalFields
          disposed={disposed}
          reason={reason}
          onDisposed={(value, err) => {
            setDisposed(value);
            setDateErrors((e) => ({ ...e, disposed: err }));
          }}
          onReason={setReason}
          reasonPlaceholder="Sold, given away, deleted"
        />
      )}

      <StorageFields
        locations={places}
        locationId={locationId}
        subLocationId={subLocationId}
        onLocation={(id) => {
          setLocationId(id);
          setSubLocationId("");
        }}
        onSubLocation={setSubLocationId}
      />

      <AcquisitionFields
        value={acquisition}
        onChange={setAcquisition}
        onDateError={(err) => setDateErrors((e) => ({ ...e, acquired: err }))}
        shopType="other"
      />

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
          {copy ? "Save" : "Add copy"}
        </Button>
      </div>
    </div>
  );
}
