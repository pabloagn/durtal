"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import { SingleChoiceField } from "@/components/catalogue/record-fields";
import type { PickerChoice } from "@/components/catalogue/search-picker";
import { recordWhereabouts, updateWhereabouts } from "@/lib/actions/whereabouts";
import { createVenue, searchVenues } from "@/lib/actions/venues";
import {
  DISPLAY_STATUSES,
  WHEREABOUTS_CERTAINTY,
  WHEREABOUTS_PLACES,
} from "@/lib/catalogue/paintings";
import {
  CERTAINTY_LABELS,
  CUSTODY_LABELS,
  DISPLAY_LABELS,
  PLACE_LABELS,
  type DisplayStatus,
  type WhereaboutsCertainty,
  type WhereaboutsCustody,
  type WhereaboutsPlace,
} from "@/lib/catalogue/painting-labels";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";

/** A stored location record, as the edit dialog starts from it */
export interface EditableWhereabouts {
  id: string;
  placeKind: WhereaboutsPlace;
  venue: { id: string; label: string } | null;
  placeLabel: string | null;
  custody: WhereaboutsCustody;
  displayStatus: DisplayStatus;
  certainty: WhereaboutsCertainty;
  startsOn: CatalogueDateInput | null;
  endsOn: CatalogueDateInput | null;
  occasionLabel: string | null;
  verifiedAt: string | null;
  notes: string | null;
  sourceRecordId: string | null;
}

/**
 * What the dialog records:
 * - `move`: where the object is now, from a date; the current location closes on it.
 * - `loan`: lent to a venue for an exhibition; also a move.
 * - `return`: back to the venue that owns it; also a move.
 * - `history`: a past or uncertain location, with its period.
 * - `edit`: corrects one record.
 */
export type WhereaboutsMode = "move" | "loan" | "return" | "history" | "edit";

const TITLES: Record<WhereaboutsMode, string> = {
  move: "Record a move",
  loan: "Record a loan",
  return: "Record a return",
  history: "Add to the location history",
  edit: "Edit location",
};

/** Why the object can be at each kind of place */
const CUSTODY_BY_PLACE: Record<WhereaboutsPlace, WhereaboutsCustody[]> = {
  venue: ["permanent_collection", "temporary_loan", "long_term_loan", "unknown"],
  private: ["private", "unknown"],
  unknown: ["private", "unknown"],
  lost: ["unknown"],
  destroyed: ["unknown"],
};

export function WhereaboutsDialog({
  open,
  onClose,
  objectId,
  objectName,
  fingerprint,
  mode,
  record,
  ownerVenue,
  hasCurrent,
  sources,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  /** "Original", shown under the title */
  objectName: string;
  /** The object's location history fingerprint */
  fingerprint: string;
  mode: WhereaboutsMode;
  record?: EditableWhereabouts;
  /** The venue of its last permanent collection: where a return goes */
  ownerVenue: { id: string; label: string } | null;
  /** The object has a confirmed current location that a move closes */
  hasCurrent: boolean;
  sources: { id: string; label: string }[];
}) {
  return (
    <Dialog open={open} onClose={onClose} title={TITLES[mode]} description={objectName} className="max-w-2xl">
      {open && (
        <WhereaboutsForm
          objectId={objectId}
          fingerprint={fingerprint}
          mode={mode}
          record={record}
          ownerVenue={ownerVenue}
          hasCurrent={hasCurrent}
          sources={sources}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
}

function initial(
  mode: WhereaboutsMode,
  record: EditableWhereabouts | undefined,
  ownerVenue: { id: string; label: string } | null,
) {
  if (record) return record;
  const base = {
    placeKind: "venue" as WhereaboutsPlace,
    venue: null as { id: string; label: string } | null,
    placeLabel: null,
    custody: "unknown" as WhereaboutsCustody,
    displayStatus: "unknown" as DisplayStatus,
    certainty: "confirmed" as WhereaboutsCertainty,
    startsOn: null,
    endsOn: null,
    occasionLabel: null,
    verifiedAt: null,
    notes: null,
    sourceRecordId: null,
  };
  if (mode === "loan") return { ...base, custody: "temporary_loan" as const, displayStatus: "on_display" as const };
  if (mode === "return")
    return { ...base, venue: ownerVenue, custody: "permanent_collection" as const };
  if (mode === "move") return { ...base, custody: "permanent_collection" as const };
  return base;
}

function WhereaboutsForm({
  objectId,
  fingerprint,
  mode,
  record,
  ownerVenue,
  hasCurrent,
  sources,
  onDone,
}: {
  objectId: string;
  fingerprint: string;
  mode: WhereaboutsMode;
  record?: EditableWhereabouts;
  ownerVenue: { id: string; label: string } | null;
  hasCurrent: boolean;
  sources: { id: string; label: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const start = initial(mode, record, ownerVenue);
  const [placeKind, setPlaceKind] = useState<WhereaboutsPlace>(start.placeKind);
  const [venue, setVenue] = useState(start.venue);
  const [placeLabel, setPlaceLabel] = useState(start.placeLabel ?? "");
  const [custody, setCustody] = useState<WhereaboutsCustody>(start.custody);
  const [displayStatus, setDisplayStatus] = useState<DisplayStatus>(start.displayStatus);
  const [certainty, setCertainty] = useState<WhereaboutsCertainty>(start.certainty);
  const [startsOn, setStartsOn] = useState(start.startsOn);
  const [endsOn, setEndsOn] = useState(start.endsOn);
  const [occasion, setOccasion] = useState(start.occasionLabel ?? "");
  const [checkedNow, setCheckedNow] = useState(mode !== "history" && mode !== "edit");
  const [notes, setNotes] = useState(start.notes ?? "");
  const [sourceRecordId, setSourceRecordId] = useState(start.sourceRecordId);
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchPlaces = useCallback(
    async (query: string): Promise<PickerChoice[]> =>
      (await searchVenues(query)).map((v) => ({
        id: v.id,
        label: v.name,
        hint: v.place?.name ?? null,
      })),
    [],
  );
  const createPlace = useCallback(async (name: string): Promise<PickerChoice> => {
    const created = await createVenue({ name, type: "museum" });
    return { id: created.id, label: created.name };
  }, []);

  // A move is confirmed and open-ended; only history and edits choose
  const isMove = mode === "move" || mode === "loan" || mode === "return";
  const custodies = CUSTODY_BY_PLACE[placeKind];
  const needsStart = isMove && hasCurrent && !startsOn;
  const blocked =
    (placeKind === "venue" && !venue) ||
    needsStart ||
    Object.values(dateErrors).some(Boolean) ||
    saving;

  function choosePlace(next: WhereaboutsPlace) {
    setPlaceKind(next);
    if (next !== "venue") {
      setVenue(null);
      setDisplayStatus("unknown");
    }
    if (!CUSTODY_BY_PLACE[next].includes(custody)) setCustody(CUSTODY_BY_PLACE[next][0]);
  }

  async function save() {
    if (blocked) return;
    setSaving(true);
    setError(null);
    const fields = {
      placeKind,
      venueId: placeKind === "venue" ? (venue?.id ?? null) : null,
      placeLabel: placeKind === "venue" ? null : placeLabel.trim() || null,
      custody,
      displayStatus: placeKind === "venue" ? displayStatus : ("unknown" as const),
      certainty: isMove ? ("confirmed" as const) : certainty,
      startsOn,
      endsOn: isMove ? null : endsOn,
      occasionLabel: occasion.trim() || null,
      verifiedAt: checkedNow ? new Date().toISOString() : (record?.verifiedAt ?? null),
      notes: notes.trim() || null,
      sourceRecordId,
    };
    try {
      if (record) await updateWhereabouts(record.id, fields, fingerprint);
      else await recordWhereabouts({ objectId, ...fields }, fingerprint);
      toast.success(record ? "Location saved" : "Location recorded");
      onDone();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the location";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="Where"
          value={placeKind}
          onChange={(e) => choosePlace(e.target.value as WhereaboutsPlace)}
          options={WHEREABOUTS_PLACES.map((p) => ({ value: p, label: PLACE_LABELS[p] }))}
        />
        {placeKind !== "venue" && placeKind !== "lost" && placeKind !== "destroyed" && (
          <Input
            label={placeKind === "private" ? "Which place" : "What is said"}
            value={placeLabel}
            onChange={(e) => setPlaceLabel(e.target.value)}
            placeholder={placeKind === "private" ? "A collector in Zürich" : "Last seen in Vienna, 1945"}
            maxLength={300}
          />
        )}
      </div>
      {placeKind === "venue" && (
        <SingleChoiceField
          label="Venue"
          value={venue}
          onChange={setVenue}
          search={searchPlaces}
          onCreate={createPlace}
          placeholder="Search museums and galleries..."
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="Why it is there"
          value={custody}
          onChange={(e) => setCustody(e.target.value as WhereaboutsCustody)}
          options={custodies.map((c) => ({ value: c, label: CUSTODY_LABELS[c] }))}
        />
        {placeKind === "venue" && (
          <Select
            label="Shown"
            value={displayStatus}
            onChange={(e) => setDisplayStatus(e.target.value as DisplayStatus)}
            options={DISPLAY_STATUSES.map((d) => ({ value: d, label: DISPLAY_LABELS[d] }))}
          />
        )}
      </div>

      {(custody === "temporary_loan" || custody === "long_term_loan" || occasion) && (
        <Input
          label="Exhibition or occasion"
          value={occasion}
          onChange={(e) => setOccasion(e.target.value)}
          placeholder="Bosch: The 5th Centenary Exhibition"
          maxLength={300}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <CatalogueDateField
          label={isMove ? "Since" : "From"}
          value={startsOn}
          onChange={(value, err) => {
            setStartsOn(value);
            setDateErrors((e) => ({ ...e, starts: err }));
          }}
        />
        {!isMove && (
          <CatalogueDateField
            label="Until"
            value={endsOn}
            onChange={(value, err) => {
              setEndsOn(value);
              setDateErrors((e) => ({ ...e, ends: err }));
            }}
          />
        )}
      </div>
      {needsStart && (
        <p className="text-xs text-fg-secondary">
          Give the date of the move: the current location closes on it.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {!isMove && (
          <Select
            label="How sure"
            value={certainty}
            onChange={(e) => setCertainty(e.target.value as WhereaboutsCertainty)}
            options={WHEREABOUTS_CERTAINTY.map((c) => ({ value: c, label: CERTAINTY_LABELS[c] }))}
          />
        )}
        {sources.length > 0 && (
          <Select
            label="Source"
            value={sourceRecordId ?? ""}
            placeholder="No source"
            onChange={(e) => setSourceRecordId(e.target.value || null)}
            options={sources.map((s) => ({ value: s.id, label: s.label }))}
          />
        )}
      </div>

      <label className="flex items-center gap-3 text-sm text-fg-primary">
        <Switch checked={checkedNow} onCheckedChange={setCheckedNow} aria-label="Checked today" />
        Checked today
      </label>

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
          {record ? "Save" : "Record"}
        </Button>
      </div>
    </div>
  );
}
