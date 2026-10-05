"use client";

import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import type { NoteEdit } from "@/lib/actions/reading-notes";
import { ordinalRead } from "@/lib/reading/labels";
import { noteWhereText, type CopyBook } from "@/lib/reading/notes-text";
import { NoteControls } from "./note-controls";
import { NoteItemView } from "./note-item";
import { useReading } from "./reading-provider";

/** The words under a quote or note on its book page: "Note · p. 212 · ch. 7 · 2nd read" */
export function noteMeta(note: NoteEdit) {
  return [note.kind === "note" ? "Note" : null, noteWhereText(note), note.readingOrdinal ? ordinalRead(note.readingOrdinal) : null]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The book page's "Quotes and notes" (SLN-453), after the Reading section
 * and only when the book has some: by page, then the order added.
 */
export function NotesSection({ notes, book }: { notes: NoteEdit[]; book: CopyBook }) {
  const { open, openRow } = useReading();
  return (
    <section className="mb-8" id="quotes" data-notes-section="">
      <SectionHeading
        title="Quotes and notes"
        count={notes.length}
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => open({ kind: "note", noteKind: "quote", readingId: openRow?.reading.id })}
            className="pointer-coarse:h-11"
            data-notes-add=""
          >
            Add a quote
          </Button>
        }
      />
      <ul>
        {notes.map((note) => (
          <li key={note.id} className="border-t border-glass-border py-5 first:border-t-0 first:pt-0">
            <NoteItemView note={note} meta={noteMeta(note)} controls={<NoteControls note={note} book={book} />} />
          </li>
        ))}
      </ul>
    </section>
  );
}
