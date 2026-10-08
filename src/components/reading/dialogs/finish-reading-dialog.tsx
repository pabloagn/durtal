"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { RatingInput } from "@/components/shared/rating";
import { TiptapEditor, type RichValue } from "@/components/shared/tiptap-editor";
import { finishReading, getNextInSeries, reopenReading } from "@/lib/actions/reading";
import { finishAfterStart } from "@/lib/validations/reading";
import { formatRating } from "@/lib/utils/rating";
import { browserZone, showError, todayReadingDay, undoToast } from "../reading-client";
import type { ReadingDialogProps } from "../reading-provider";
import { DialogFooter, ReadingDateField, type ReadingDate } from "./fields";

type NextVolume = Awaited<ReturnType<typeof getNextInSeries>>;

/** The start-and-finish rule, in the dialog's words */
export function finishDateError(
  start: { startedOn: string | null; startedPrecision: string },
  finish: ReadingDate,
): string | null {
  return finishAfterStart({ ...start, finishedOn: finish.date, finishedPrecision: finish.precision })
    ? null
    : "The finish date is before the start date";
}

/** Finish: the date, a half-star rating, the book's rating, a review; Undo; the next volume */
export function FinishReadingDialog({ data, row, request, home, onClose, changed }: ReadingDialogProps) {
  const r = row!.reading;
  const switchId = useId();
  const [finish, setFinish] = useState<ReadingDate>(() => ({ date: request.finishedOn ?? todayReadingDay(data.dayStartHour), precision: "day" }));
  const [rating, setRating] = useState<number | null>(r.rating != null ? Number(r.rating) : null);
  const [setBook, setSetBook] = useState(true);
  const [review, setReview] = useState<RichValue | null>(r.reviewHtml ? { html: r.reviewHtml, json: r.reviewJson ?? null } : null);
  const [saving, setSaving] = useState(false);
  const [next, setNext] = useState<NextVolume>(null);
  const error = finishDateError(r, finish);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (error) return;
    setSaving(true);
    try {
      const result = await finishReading({
        readingId: r.id,
        fingerprint: row!.fingerprint,
        finishedOn: finish.date,
        finishedPrecision: finish.date ? finish.precision : "unknown",
        rating,
        ...(review ? { reviewHtml: review.html, reviewJson: review.json } : {}),
        setBookRating: setBook,
        timeZone: browserZone(),
      });
      changed();
      undoToast(`Finished ${data.workTitle}`, async () => {
        try {
          const back = await reopenReading({ readingId: r.id, fingerprint: result.reading.fingerprint, ...result.undo });
          if (back.message) toast.message(back.message);
          changed();
        } catch (err) {
          showError(err, changed);
        }
      });
      const volume = await getNextInSeries(data.workId, home && home !== "none" ? home : null).catch(() => null);
      if (volume) setNext(volume);
      else onClose();
    } catch (err) {
      showError(err, changed);
    } finally {
      setSaving(false);
    }
  }

  if (next)
    return (
      <Dialog open onClose={onClose} title="Finished" description={data.workTitle} className="max-w-lg">
        <div className="space-y-4">
          <p className="text-sm text-fg-primary" data-next-volume>
            Next in {next.seriesTitle ?? "the series"}: {next.title}, {next.whereabouts.charAt(0).toLowerCase() + next.whereabouts.slice(1)}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} className="pointer-coarse:h-11">
              Close
            </Button>
            <Link
              href={`/library/${next.slug ?? next.id}?then=start`}
              onClick={onClose}
              className="inline-flex h-8 items-center rounded-sm bg-action-fill px-3 text-sm text-action-fg hover:bg-action-hover pointer-coarse:h-11"
            >
              Start reading
            </Link>
          </div>
        </div>
      </Dialog>
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title="Finish"
      description={request.reachedEnd ? "You reached the last page. Finish the book?" : data.workTitle}
      className="max-w-lg"
    >
      <form onSubmit={save} className="space-y-4">
        <ReadingDateField label="Finished on" value={finish} onChange={setFinish} />
        {error && (
          <p className="text-xs text-accent-red-text" role="alert">
            {error}
          </p>
        )}
        <div className="space-y-1.5">
          <span className="type-label block">Your rating of this read</span>
          <div className="text-sm">
            <RatingInput value={rating} onChange={setRating} label="Your rating of this read" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch id={switchId} checked={setBook} onCheckedChange={setSetBook} />
          <label htmlFor={switchId} className="text-sm text-fg-secondary">
            Also set as this book&apos;s rating{" "}
            <span className="text-xs">({data.bookRating != null ? `Book rating now ${formatRating(data.bookRating)}` : "No book rating"})</span>
          </label>
        </div>
        <TiptapEditor label="Review" value={review} onChange={setReview} placeholder="What stayed with you" />
        <DialogFooter onCancel={onClose} saving={saving} saveLabel="Finish" disabled={!!error} />
      </form>
    </Dialog>
  );
}
