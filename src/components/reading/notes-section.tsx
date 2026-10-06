"use client";

import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import type { NoteEdit } from "@/lib/actions/reading-notes";
import type { NoteEdition } from "@/lib/reading/edition-label";
import { ordinalRead } from "@/lib/reading/labels";
import { noteGroups, noteWhereText, quotesAnchor, type CopyBook } from "@/lib/reading/notes-text";
import { NoteControls } from "./note-controls";
import { NoteItemView } from "./note-item";
import { useReading } from "./reading-provider";

/** The words under a quote or note on its book page: "Note · p. 212 · ch. 7 · 2nd read"; the group names the edition */
export function noteMeta(note: NoteEdit) {
  return [note.kind === "note" ? "Note" : null, noteWhereText(note), note.readingOrdinal ? ordinalRead(note.readingOrdinal) : null]
    .filter(Boolean)
    .join(" · ");
}

function Notes({ notes, book, editions }: { notes: NoteEdit[]; book: CopyBook; editions: Record<string, NoteEdition> }) {
  return (
    <ul>
      {notes.map((note) => (
        <li key={note.id} className="border-t border-glass-border py-5 first:border-t-0 first:pt-0">
          <NoteItemView
            note={note}
            meta={noteMeta(note)}
            controls={<NoteControls note={note} book={book} edition={note.editionId ? (editions[note.editionId] ?? null) : null} />}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * The book page's "Quotes and notes" (SLN-453), after the Reading section
 * and only when the book has some. Grouped by edition (SLN-480), each group
 * under its edition's heading with its count; one group is named in the
 * section's description instead.
 */
export function NotesSection({
  notes,
  book,
  editions,
  editionOrder,
}: {
  notes: NoteEdit[];
  book: CopyBook;
  editions: Record<string, NoteEdition>;
  editionOrder: string[];
}) {
  const { open, openRow } = useReading();
  const groups = noteGroups(notes, editionOrder, editions);
  const one = groups.length === 1 ? groups[0] : null;
  return (
    <section className="mb-8" id="quotes" data-notes-section="">
      <SectionHeading
        title="Quotes and notes"
        count={notes.length}
        description={one ? (one.editionId ? `From ${one.label}` : one.label) : undefined}
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
      {one ? (
        <div id={quotesAnchor(one.editionId)} data-notes-group={one.editionId ?? "none"}>
          <Notes notes={one.notes} book={book} editions={editions} />
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.editionId ?? "none"} id={quotesAnchor(group.editionId)} className="scroll-mt-8" data-notes-group={group.editionId ?? "none"}>
              <SectionHeading as="h3" title={group.label} count={group.notes.length} />
              <Notes notes={group.notes} book={book} editions={editions} />
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
