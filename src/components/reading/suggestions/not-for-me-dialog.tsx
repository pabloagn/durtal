"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter } from "../dialogs/fields";
import { FEEDBACK_NOTE_MAX, FEEDBACK_REASONS, FEEDBACK_REASON_LABELS, type FeedbackReason } from "@/lib/reading/constants";
import { useSuggestionFeedback } from "./use-feedback";

/** "Already read it" opens Log a past read instead of storing feedback */
const REASONS = FEEDBACK_REASONS.filter((r) => r !== "already_read");

/** Not for me because…: one reason or more and a note; the book is hidden like Never until the row is removed (SLN-457) */
export function NotForMeDialog({ workId, title, onClose }: { workId: string; title: string; onClose: () => void }) {
  const give = useSuggestionFeedback();
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const legend = useId();
  const toggle = (r: FeedbackReason) => setReasons((now) => (now.includes(r) ? now.filter((x) => x !== r) : [...now, r]));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!reasons.length) return;
    setSaving(true);
    const ok = await give(workId, title, "rejected", { reasons, note: note.trim() || null });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Not for me because…" description={title} className="max-w-md">
      <form onSubmit={save} className="space-y-4" data-not-for-me="">
        <fieldset aria-labelledby={legend}>
          <p id={legend} className="type-label mb-2">
            Reasons
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {REASONS.map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-fg-primary pointer-coarse:min-h-11">
                <input type="checkbox" checked={reasons.includes(r)} onChange={() => toggle(r)} className="h-4 w-4" data-reason={r} />
                {FEEDBACK_REASON_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>
        <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={FEEDBACK_NOTE_MAX} rows={3} />
        <DialogFooter onCancel={onClose} saving={saving} saveLabel="Hide it" disabled={!reasons.length} />
      </form>
    </Dialog>
  );
}
