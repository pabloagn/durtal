"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { abandonReading, pauseReading, reopenReading } from "@/lib/actions/reading";
import { ABANDON_REASONS, ABANDON_REASON_LABELS, type AbandonReason } from "@/lib/reading/constants";
import { browserZone, showError, todayReadingDay, undoToast } from "../reading-client";
import type { ReadingDialogProps } from "../reading-provider";
import { DialogFooter, ReadingDateField, type ReadingDate } from "./fields";
import { finishDateError } from "./finish-reading-dialog";
import { readNumber } from "./start-reading-dialog";

/** Abandon: when, the page reached, why; or pause instead; Undo */
export function AbandonReadingDialog({ data, row, onClose, changed }: ReadingDialogProps) {
  const r = row!.reading;
  const [stopped, setStopped] = useState<ReadingDate>(() => ({ date: todayReadingDay(data.dayStartHour), precision: "day" }));
  const byPage = r.unit === "pages" && !!r.totalPages;
  const [reached, setReached] = useState(byPage ? String(r.currentPage ?? "") : String(Math.round(r.currentPercent ?? 0)));
  const [reason, setReason] = useState<AbandonReason>("lost_interest");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const error = finishDateError(r, stopped);
  const value = readNumber(reached);
  const reachedError =
    reached.trim() && (value === null || (byPage ? !Number.isInteger(value) || value > (r.totalPages ?? Infinity) : value > 100))
      ? byPage
        ? `Enter a page up to ${r.totalPages}`
        : "Enter 0 to 100%"
      : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (error || reachedError) return;
    setSaving(true);
    try {
      const result = await abandonReading({
        readingId: r.id,
        fingerprint: row!.fingerprint,
        stoppedOn: stopped.date,
        stoppedPrecision: stopped.date ? stopped.precision : "unknown",
        reason,
        note: note.trim() || null,
        ...(value !== null ? (byPage ? { page: value } : { percent: value }) : {}),
        timeZone: browserZone(),
      });
      onClose();
      changed();
      undoToast(`Abandoned ${data.workTitle}`, async () => {
        try {
          await reopenReading({ readingId: r.id, fingerprint: result.reading.fingerprint, ...result.undo });
          changed();
        } catch (err) {
          showError(err, changed);
        }
      });
    } catch (err) {
      showError(err, changed);
    } finally {
      setSaving(false);
    }
  }

  async function pauseInstead() {
    try {
      await pauseReading({ readingId: r.id, fingerprint: row!.fingerprint });
      toast.success("Paused");
      onClose();
      changed();
    } catch (err) {
      showError(err, changed);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Abandon" description={data.workTitle} className="max-w-lg">
      <form onSubmit={save} className="space-y-4">
        <ReadingDateField label="Stopped on" value={stopped} onChange={setStopped} />
        {error && (
          <p className="text-xs text-accent-red-text" role="alert">
            {error}
          </p>
        )}
        <Input
          label={byPage ? "Page reached" : "Percent reached"}
          inputMode={byPage ? "numeric" : "decimal"}
          value={reached}
          onChange={(e) => setReached(e.target.value)}
          error={reachedError ?? undefined}
          className="w-32"
        />
        <Select
          label="Why"
          value={reason}
          onChange={(e) => setReason(e.target.value as AbandonReason)}
          options={ABANDON_REASONS.map((value) => ({ value, label: ABANDON_REASON_LABELS[value] }))}
        />
        <Textarea aria-label="Note" placeholder="A note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
        <p className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
          Might come back to it?
          <Button type="button" size="sm" variant="ghost" onClick={pauseInstead} className="pointer-coarse:h-11">
            Pause instead
          </Button>
        </p>
        <DialogFooter onCancel={onClose} saving={saving} saveLabel="Abandon" disabled={!!error || !!reachedError} />
      </form>
    </Dialog>
  );
}
