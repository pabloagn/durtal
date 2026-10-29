"use client";

import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { type NoteEdit } from "@/lib/actions/reading-notes";
import type { NoteEdition } from "@/lib/reading/edition-label";
import { formatNoteForCopy, type CopyBook } from "@/lib/reading/notes-text";
import { showError, undoToast } from "./reading-client";
import { useReadingDialogs } from "./reading-dialogs-provider";
import { useOptionalReading } from "./reading-provider";
import { refreshServerAnnotations } from "@/lib/reader/annotation-server-changes";
import { deleteReadingNote, restoreReadingNote, toggleNoteFavourite } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

const menuButton =
  "action-icon";

/**
 * A quote's or note's star and menu (SLN-453): Edit opens the note dialog
 * (the book page's own, else the shared one), Copy puts the passage and its
 * source on the clipboard (the edition's translator, publisher and year,
 * SLN-480), Delete has a 10-second Undo.
 */
export function NoteControls({ note, book, edition = null }: { note: NoteEdit; book: CopyBook; edition?: NoteEdition | null }) {
  const router = useRouter();
  const dialogs = useReadingDialogs();
  const page = useOptionalReading();
  const noun = note.kind === "quote" ? "quote" : "note";
  const label = `More for this ${noun}`;
  const changed = () => {
    router.refresh();
    triggerActivityRefresh();
  };

  function edit() {
    if (page && page.data.workId === note.workId) page.open({ kind: "note", note, readingId: note.readingId ?? undefined });
    else void dialogs.open({ kind: "note", workId: note.workId, note });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatNoteForCopy(note, book, edition));
      toast.success(note.kind === "quote" ? "Quote copied" : "Note copied");
    } catch {
      toast.error("Could not copy. Allow clipboard access and try again.");
    }
  }

  async function remove() {
    try {
      const snapshot = await deleteReadingNote({ id: note.id });
      changed();
      if (snapshot.readerQuoteUndo) void refreshServerAnnotations(snapshot.readerQuoteUndo.ebookId).catch(() => {
        toast.error("Quote deleted. Refresh highlights when connected.");
      });
      undoToast(note.kind === "quote" ? "Quote deleted" : "Note deleted", async () => {
        try {
          await restoreReadingNote(JSON.parse(JSON.stringify(snapshot)));
          changed();
          if (snapshot.readerQuoteUndo) void refreshServerAnnotations(snapshot.readerQuoteUndo.ebookId).catch(() => {
            toast.error("Quote restored. Refresh highlights when connected.");
          });
        } catch (err) {
          showError(err, changed);
          return false;
        }
      }, "Entry restored");
    } catch (err) {
      showError(err, changed);
    }
  }

  return (
    <span className="flex items-center gap-1">
      <FavouriteToggle
        favourite={note.isFavourite}
        name={`this ${noun}`}
        onToggle={async () => {
          try {
            await toggleNoteFavourite({ id: note.id });
            router.refresh();
            return true;
          } catch (error) {
            toast.error(refusalMessage(error, "Could not update the favourite. Try again."));
            return false;
          }
        }}
      />
      <DropdownMenu
        label={label}
        align="end"
        trigger={
          <button type="button" aria-label={label} data-tooltip="More" className={menuButton} data-note-menu={note.id}>
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
          </button>
        }
      >
        <DropdownMenuItem onClick={edit}>Edit</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void copy()}>Copy</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onClick={() => void remove()}>
          Delete
        </DropdownMenuItem>
      </DropdownMenu>
    </span>
  );
}
