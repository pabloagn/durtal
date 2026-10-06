"use client";

import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import { deleteReading, restoreReading } from "@/lib/actions/reading";
import { ordinalRead } from "@/lib/reading/labels";
import { keptNotesText } from "@/lib/reading/notes-text";
import { showError, undoToast } from "../reading-client";
import type { ReadingDialogProps } from "../reading-provider";

/** Delete a reading with its sessions and history; Undo puts it back with the same ids */
export function DeleteReadingDialog({ data, row, onClose, changed }: ReadingDialogProps) {
  const r = row!;
  return (
    <ConfirmDeleteDialog
      open
      onClose={onClose}
      title="Delete reading"
      name={`${ordinalRead(r.ordinal)} of ${data.workTitle}`}
      description={`This deletes the reading, its ${r.sessionCount} ${r.sessionCount === 1 ? "session" : "sessions"} and its history.${keptNotesText(r.quoteCount, r.noteCount)}`}
      onConfirm={async () => {
        try {
          const snapshot = await deleteReading({ readingId: r.reading.id, fingerprint: r.fingerprint });
          onClose();
          changed();
          undoToast("Reading deleted", async () => {
            try {
              await restoreReading(JSON.parse(JSON.stringify(snapshot)));
              changed();
            } catch (err) {
              showError(err, changed);
            }
          });
        } catch (err) {
          showError(err, changed);
        }
      }}
    />
  );
}
