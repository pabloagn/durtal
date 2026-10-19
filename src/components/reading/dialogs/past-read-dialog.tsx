"use client";

import { useRef, useState, useId } from "react";
import { toast } from "@/lib/notifications/toast";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { RatingInput } from "@/components/shared/rating";
import { TiptapEditor, type RichValue } from "@/components/shared/tiptap-editor";
import { addPastReading } from "@/lib/actions/catalogue-client";
import { ABANDON_REASONS, ABANDON_REASON_LABELS, formatOfCopy, type AbandonReason, type ReadingFormat } from "@/lib/reading/constants";
import { browserZone, showError } from "../reading-client";
import { readingDateError, readingDateLimit } from "@/lib/reading/dates";
import type { ReadingDialogProps } from "../reading-provider";
import { DialogFooter, ReadingDateField, type ReadingDate } from "./fields";
import { finishDateError } from "./finish-reading-dialog";

const OUTCOMES = [
  { value: "finished", label: "Finished" },
  { value: "abandoned", label: "Abandoned" },
] as const;
const FORMATS = [
  { value: "print", label: "Print" },
  { value: "ebook", label: "eBook" },
  { value: "audio", label: "Audio" },
] as const;

/**
 * "This is before the book was written, in 1947": a date the work's year
 * makes unlikely, said but not refused, since a year can be wrong (SLN-932)
 */
export function beforeWritten(workYear: number | null | undefined, ...dates: ReadingDate[]) {
  if (workYear == null) return null;
  const year = dates.map((d) => (d.date ? Number(d.date.slice(0, 4)) : null)).find((y) => y !== null && y < workYear);
  if (year == null) return null;
  return `This is before the book was written, in ${workYear < 0 ? `${-workYear} BC` : workYear}. You can still log it.`;
}

/** A read from the past, at any date precision: "2009", "Apr 2019" */
export function PastReadDialog({ data, onClose, changed }: ReadingDialogProps) {
  const [status, setStatus] = useState<"finished" | "abandoned">("finished");
  // The footer sits outside the form, under the dialog's scrolling body
  const formId = useId();
  const [editionId, setEditionId] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [format, setFormat] = useState<ReadingFormat>("print");
  const edition = data.editions.find((e) => e.id === editionId) ?? null;
  const copy = edition?.copies.find((c) => c.id === instanceId) ?? null;
  const [homeId, setHomeId] = useState("");
  const [start, setStart] = useState<ReadingDate>({ date: null, precision: "unknown" });
  const [finish, setFinish] = useState<ReadingDate>({ date: null, precision: "unknown" });
  const [rating, setRating] = useState<number | null>(null);
  const [review, setReview] = useState<RichValue | null>(null);
  const [reason, setReason] = useState<AbandonReason>("lost_interest");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // One save at a time: a second press of Log read or Save anyway before the
  // first returns would log the read twice
  const inFlight = useRef(false);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const maxDate = readingDateLimit(browserZone());
  const error = readingDateError(start.date, start.precision, maxDate)
    ?? readingDateError(finish.date, finish.precision, maxDate)
    ?? finishDateError({ startedOn: start.date, startedPrecision: start.precision }, finish);
  const early = beforeWritten(data.workYear, start, finish);

  function chooseCopy(id: string) {
    setInstanceId(id);
    const next = edition?.copies.find((c) => c.id === id);
    if (next) setFormat(formatOfCopy(next.format));
    if (next?.locationType === "physical") setHomeId(next.locationId);
  }

  async function submit(allowPossibleDuplicate = false) {
    if (error || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await addPastReading({
        workId: data.workId,
        editionId: editionId || null,
        instanceId: instanceId || null,
        locationId: homeId || (copy?.locationType === "physical" ? copy.locationId : null),
        format,
        totalPages: edition?.pageCount ?? null,
        status,
        startedOn: start.date,
        startedPrecision: start.date ? start.precision : "unknown",
        finishedOn: finish.date,
        finishedPrecision: finish.date ? finish.precision : "unknown",
        rating,
        ...(review ? { reviewHtml: review.html, reviewJson: review.json } : {}),
        ...(status === "abandoned" ? { reason, note: note.trim() || null } : {}),
        allowPossibleDuplicate,
        timeZone: browserZone(),
      });
      if (result.outcome === "possible_duplicate") {
        setDuplicate(result.message ?? "This may be a read you already logged");
        return;
      }
      if (result.outcome === "already_present") toast.info(result.message ?? "You already logged this read");
      else toast.success("Logged a past read");
      onClose();
      changed();
    } catch (err) {
      showError(err, changed);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog draft open onClose={onClose} title="Log a past read" description={data.workTitle} className="max-w-lg">
      <form id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <SegmentedControl options={OUTCOMES} value={status} onChange={setStatus} ariaLabel="How it ended" />
        {data.editions.length > 0 && (
          <Select
            label="Edition (optional)"
            wrap
            value={editionId}
            onChange={(e) => {
              setEditionId(e.target.value);
              setInstanceId("");
            }}
            options={[{ value: "", label: "Not recorded" }, ...data.editions.map((ed) => ({ value: ed.id, label: ed.label }))]}
          />
        )}
        {edition && edition.copies.length > 0 && (
          <Select
            label="Copy (optional)"
            value={instanceId}
            onChange={(e) => chooseCopy(e.target.value)}
            options={[{ value: "", label: "No copy" }, ...edition.copies.map((c) => ({ value: c.id, label: c.line }))]}
          />
        )}
        <div className="space-y-1.5">
          <span className="type-label block">Format</span>
          <SegmentedControl options={FORMATS} value={format} onChange={setFormat} ariaLabel="Format" />
        </div>
        {data.homes.length > 0 && (
          <Select
            label="Home (optional)"
            value={homeId}
            onChange={(e) => setHomeId(e.target.value)}
            options={[{ value: "", label: "Not recorded" }, ...data.homes.map((h) => ({ value: h.id, label: h.name }))]}
          />
        )}
        {/* The dialog starts here, in the first date, under the lists a book's record fills (SLN-1094) */}
        <div data-autofocus="">
          <ReadingDateField label="Started" value={start} onChange={setStart} max={maxDate} />
        </div>
        <ReadingDateField label={status === "finished" ? "Finished" : "Stopped"} value={finish} onChange={setFinish} max={maxDate} />
        {error && (
          <p className="text-xs text-accent-red-text" role="alert">
            {error}
          </p>
        )}
        {!error && early && <p className="text-xs text-fg-secondary">{early}</p>}
        <div className="space-y-1.5">
          <span className="type-label block">Rating</span>
          <div className="text-sm">
            <RatingInput value={rating} onChange={setRating} label="Rating" />
          </div>
        </div>
        {status === "abandoned" && (
          <>
            <Select
              label="Why"
              value={reason}
              onChange={(e) => setReason(e.target.value as AbandonReason)}
              options={ABANDON_REASONS.map((value) => ({ value, label: ABANDON_REASON_LABELS[value] }))}
            />
            <Textarea aria-label="Note" placeholder="A note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
          </>
        )}
        <TiptapEditor label="Review" value={review} onChange={setReview} placeholder="What stayed with you" />
        <DialogFooter
          form={formId}
          onCancel={onClose}
          saving={saving}
          saveLabel="Log read"
          disabled={!!error}
          notice={duplicate && (
            <div className="flex basis-full flex-wrap items-center gap-2 rounded-sm border border-glass-border p-3 text-sm text-fg-secondary" role="alert">
              {duplicate}
              <Button type="button" size="sm" variant="ghost" onClick={() => void submit(true)} busy={saving} className="pointer-coarse:h-11">
                Save anyway
              </Button>
            </div>
          )}
        />
      </form>
    </Dialog>
  );
}
