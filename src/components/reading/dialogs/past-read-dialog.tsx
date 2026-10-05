"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { RatingInput } from "@/components/shared/rating";
import { TiptapEditor, type RichValue } from "@/components/shared/tiptap-editor";
import { addPastReading } from "@/lib/actions/reading";
import { ABANDON_REASONS, ABANDON_REASON_LABELS, formatOfCopy, type AbandonReason, type ReadingFormat } from "@/lib/reading/constants";
import { showError } from "../reading-client";
import type { ReadingDialogProps } from "../reading-provider";
import { DialogFooter, ReadingDateField, type ReadingDate } from "./fields";
import { finishDateError } from "./finish-reading-dialog";

const OUTCOMES = [
  { value: "finished", label: "Finished" },
  { value: "abandoned", label: "Abandoned" },
] as const;
const FORMATS = [
  { value: "print", label: "Print" },
  { value: "ebook", label: "E-book" },
  { value: "audio", label: "Audio" },
] as const;

/** A read from the past, at any date precision: "2009", "Apr 2019" */
export function PastReadDialog({ data, onClose, changed }: ReadingDialogProps) {
  const [status, setStatus] = useState<"finished" | "abandoned">("finished");
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
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const error = finishDateError({ startedOn: start.date, startedPrecision: start.precision }, finish);

  function chooseCopy(id: string) {
    setInstanceId(id);
    const next = edition?.copies.find((c) => c.id === id);
    if (next) setFormat(formatOfCopy(next.format));
    if (next?.locationType === "physical") setHomeId(next.locationId);
  }

  async function submit(allowPossibleDuplicate = false) {
    if (error) return;
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
      });
      if (result.outcome === "possible_duplicate") {
        setDuplicate(result.message ?? "This may be a read you already logged");
        return;
      }
      if (result.outcome === "already_present") toast.message(result.message ?? "You already logged this read");
      else toast.success("Logged a past read");
      onClose();
      changed();
    } catch (err) {
      showError(err, changed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Log a past read" description={data.workTitle} className="max-w-lg">
      <form
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
        <ReadingDateField label="Started" value={start} onChange={setStart} />
        <ReadingDateField label={status === "finished" ? "Finished" : "Stopped"} value={finish} onChange={setFinish} />
        {error && (
          <p className="text-xs text-accent-red-text" role="alert">
            {error}
          </p>
        )}
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
        {duplicate && (
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-glass-border p-3 text-sm text-fg-secondary" role="alert">
            {duplicate}
            <Button type="button" size="sm" variant="ghost" onClick={() => void submit(true)} className="pointer-coarse:h-11">
              Save anyway
            </Button>
          </div>
        )}
        <DialogFooter onCancel={onClose} saving={saving} saveLabel="Log read" disabled={!!error} />
      </form>
    </Dialog>
  );
}
