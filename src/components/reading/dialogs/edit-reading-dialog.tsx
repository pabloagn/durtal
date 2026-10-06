"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { RatingInput } from "@/components/shared/rating";
import { TiptapEditor, type RichValue } from "@/components/shared/tiptap-editor";
import { updateReading } from "@/lib/actions/reading";
import { ABANDON_REASONS, ABANDON_REASON_LABELS, type AbandonReason, type ReadingDatePrecision, type ReadingFormat } from "@/lib/reading/constants";
import { notesCountText } from "@/lib/reading/notes-text";
import { formatMinutes, percentOf, remapPosition } from "@/lib/reading/positions";
import { showError } from "../reading-client";
import type { ReadingDialogProps } from "../reading-provider";
import { DialogFooter, parseLength, ReadingDateField, type ReadingDate } from "./fields";
import { finishDateError } from "./finish-reading-dialog";
import { readNumber } from "./start-reading-dialog";

const FORMATS = [
  { value: "print", label: "Print" },
  { value: "ebook", label: "eBook" },
  { value: "audio", label: "Audio" },
] as const;

/** What an edition switch does to the place: "p. 212 of 480 becomes p. 198 of 448" */
export function switchPreview(
  r: { currentPage: number | null; currentPercent: number | null; totalPages: number | null },
  newPages: number | null,
) {
  if (!newPages) return `${Math.round(r.currentPercent ?? 0)}% · this edition has no page count; the reading counts in percent until you give one`;
  const mapped = remapPosition(r.currentPercent, { totalPages: newPages });
  return r.currentPage !== null && r.totalPages
    ? `p. ${r.currentPage} of ${r.totalPages} becomes p. ${mapped.page} of ${newPages}`
    : `${Math.round(r.currentPercent ?? 0)}% becomes p. ${mapped.page} of ${newPages}`;
}

/** Edit a reading: edition, copy, format, home, dates, totals, rating, review, reason */
export function EditReadingDialog({ data, row, onClose, changed }: ReadingDialogProps) {
  const r = row!.reading;
  const done = r.status === "finished" || r.status === "abandoned";
  const [editionId, setEditionId] = useState(r.editionId ?? "");
  const [instanceId, setInstanceId] = useState(r.instanceId ?? "");
  const [format, setFormat] = useState<ReadingFormat>(r.format as ReadingFormat);
  const [homeId, setHomeId] = useState(r.locationId ?? "");
  const [start, setStart] = useState<ReadingDate>({ date: r.startedOn, precision: r.startedPrecision as ReadingDatePrecision });
  const [finish, setFinish] = useState<ReadingDate>({ date: r.finishedOn, precision: r.finishedPrecision as ReadingDatePrecision });
  const [pages, setPages] = useState(r.totalPages ? String(r.totalPages) : "");
  const [length, setLength] = useState(r.totalMinutes ? formatMinutes(r.totalMinutes) : "");
  const [rating, setRating] = useState<number | null>(r.rating != null ? Number(r.rating) : null);
  const [review, setReview] = useState<RichValue | null>(r.reviewHtml ? { html: r.reviewHtml, json: r.reviewJson ?? null } : null);
  const [reviewChanged, setReviewChanged] = useState(false);
  const [reason, setReason] = useState<AbandonReason>((r.abandonReason as AbandonReason) ?? "lost_interest");
  const [note, setNote] = useState(r.abandonNote ?? "");
  const [saving, setSaving] = useState(false);

  const edition = data.editions.find((e) => e.id === editionId) ?? null;
  const editionSwitched = (editionId || null) !== r.editionId;
  // Its notes on its own edition (or with none) can follow a new edition (SLN-480): unchecked by default, checked from none
  const ownNotes = row!.ownEditionQuoteCount + row!.ownEditionNoteCount;
  const [moveNotes, setMoveNotes] = useState(!r.editionId);
  const offerMove = editionSwitched && !!editionId && ownNotes > 0;
  const newTotal = readNumber(pages);
  const dateError = done ? finishDateError({ startedOn: start.date, startedPrecision: start.precision }, finish) : null;
  // A page count that is not a whole number above 0 is an error, never a cleared count
  const totalError =
    pages.trim() && (newTotal === null || !Number.isInteger(newTotal) || newTotal <= 0)
      ? "Enter the number of pages as a whole number above 0"
      : !editionSwitched && newTotal !== null && r.currentPage !== null && newTotal < r.currentPage
        ? `You are on p. ${r.currentPage}; the book cannot have ${newTotal} pages`
        : null;
  const lengthError = format === "audio" && length.trim() && parseLength(length) === null ? "Enter a length such as 9:40" : null;
  const totalLine =
    !editionSwitched && newTotal && newTotal !== r.totalPages && r.currentPage !== null
      ? `p. ${r.currentPage} of ${newTotal} · ${Math.round(percentOf({ page: r.currentPage }, { totalPages: newTotal }) ?? 0)}%`
      : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (dateError || totalError || lengthError) return;
    const patch: Parameters<typeof updateReading>[0] = { readingId: r.id, fingerprint: row!.fingerprint };
    if (editionSwitched) patch.editionId = editionId || null;
    if (offerMove && moveNotes) patch.moveNotes = true;
    if ((instanceId || null) !== r.instanceId) patch.instanceId = instanceId || null;
    if (format !== r.format) patch.format = format;
    if ((homeId || null) !== r.locationId) patch.locationId = homeId || null;
    if (start.date !== r.startedOn || start.precision !== r.startedPrecision) {
      patch.startedOn = start.date;
      patch.startedPrecision = start.date ? start.precision : "unknown";
    }
    if (done && (finish.date !== r.finishedOn || finish.precision !== r.finishedPrecision)) {
      patch.finishedOn = finish.date;
      patch.finishedPrecision = finish.date ? finish.precision : "unknown";
    }
    if (!editionSwitched && newTotal !== r.totalPages) patch.totalPages = newTotal;
    const minutes = parseLength(length);
    if (format === "audio" && minutes !== r.totalMinutes) patch.totalMinutes = minutes;
    if (rating !== (r.rating != null ? Number(r.rating) : null)) patch.rating = rating;
    if (reviewChanged) {
      patch.reviewHtml = review?.html ?? null;
      patch.reviewJson = review?.json ?? null;
    }
    if (r.status === "abandoned") {
      if (reason !== r.abandonReason) patch.abandonReason = reason;
      if ((note.trim() || null) !== r.abandonNote) patch.abandonNote = note.trim() || null;
    }
    setSaving(true);
    try {
      await updateReading(patch);
      toast.success("Reading saved");
      onClose();
      changed();
    } catch (err) {
      showError(err, changed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Edit reading" description={data.workTitle} className="max-w-lg">
      <form onSubmit={save} className="space-y-4">
        {data.editions.length > 0 && (
          <div className="space-y-1">
            <Select
              label="Edition"
              value={editionId}
              onChange={(e) => {
                setEditionId(e.target.value);
                setInstanceId("");
                const next = data.editions.find((ed) => ed.id === e.target.value);
                setPages(next?.pageCount ? String(next.pageCount) : "");
              }}
              options={[{ value: "", label: "No edition" }, ...data.editions.map((ed) => ({ value: ed.id, label: ed.label }))]}
            />
            {editionSwitched && <p className="text-xs text-fg-secondary">{switchPreview(r, edition?.pageCount ?? null)}</p>}
            {offerMove && (
              <label className="flex items-start gap-2 pt-1 text-xs text-fg-secondary pointer-coarse:min-h-11 pointer-coarse:items-center" data-edit-move-notes="">
                <input type="checkbox" checked={moveNotes} onChange={(e) => setMoveNotes(e.target.checked)} className="mt-0.5 rounded-sm pointer-coarse:mt-0" />
                {r.editionId
                  ? `Also file its ${notesCountText(row!.ownEditionQuoteCount, row!.ownEditionNoteCount)} under the new edition (pages stay as typed)`
                  : `Also file its ${notesCountText(row!.ownEditionQuoteCount, row!.ownEditionNoteCount)} with no edition under this edition`}
              </label>
            )}
          </div>
        )}
        {edition && edition.copies.length > 0 && (
          <Select
            label="Copy"
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
            options={[{ value: "", label: "No copy" }, ...edition.copies.map((c) => ({ value: c.id, label: c.line }))]}
          />
        )}
        <div className="space-y-1.5">
          <span className="type-label block">Format</span>
          <SegmentedControl options={FORMATS} value={format} onChange={setFormat} ariaLabel="Format" />
        </div>
        <Select
          label="Home"
          value={homeId}
          onChange={(e) => setHomeId(e.target.value)}
          options={[{ value: "", label: "Not recorded" }, ...data.homes.map((h) => ({ value: h.id, label: h.name }))]}
        />
        <ReadingDateField label="Started" value={start} onChange={setStart} />
        {done && <ReadingDateField label={r.status === "finished" ? "Finished" : "Stopped"} value={finish} onChange={setFinish} />}
        {dateError && (
          <p className="text-xs text-accent-red-text" role="alert">
            {dateError}
          </p>
        )}
        <div className="flex flex-wrap items-start gap-3">
          {!editionSwitched && (
            <div className="space-y-1">
              <Input label="Pages to read" inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} error={totalError ?? undefined} className="w-32" />
              {totalLine && <p className="text-xs text-fg-secondary">{totalLine}</p>}
            </div>
          )}
          {format === "audio" && (
            <Input
              label="Audio length (h:mm)"
              placeholder="9:40"
              value={length}
              onChange={(e) => setLength(e.target.value)}
              error={lengthError ?? undefined}
              className="w-32"
            />
          )}
        </div>
        <div className="space-y-1.5">
          <span className="type-label block">Rating</span>
          <div className="text-sm">
            <RatingInput value={rating} onChange={setRating} label="Rating" />
          </div>
        </div>
        {r.status === "abandoned" && (
          <>
            <Select
              label="Why"
              value={reason}
              onChange={(e) => setReason(e.target.value as AbandonReason)}
              options={ABANDON_REASONS.map((value) => ({ value, label: ABANDON_REASON_LABELS[value] }))}
            />
            <Textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
          </>
        )}
        <TiptapEditor
          label="Review"
          value={review}
          onChange={(next) => {
            setReview(next);
            setReviewChanged(true);
          }}
        />
        <DialogFooter onCancel={onClose} saving={saving} disabled={!!dateError || !!totalError || !!lengthError} />
      </form>
    </Dialog>
  );
}
