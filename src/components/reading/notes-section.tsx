"use client";

import { useEffect, useRef, useState } from "react";
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

/** A group this long opens with its first OPEN_AT notes and "Show all" (SLN-510): the page draws every note's markup */
export const LONG_GROUP = 12;
export const OPEN_AT = 10;

/** A note's own anchor: `#note-<id>` opens its group and goes to it */
export const noteAnchor = (id: string) => `note-${id}`;

/** The id in the address, when it names a note */
function hashNote() {
  const hash = typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.slice(1));
  return hash.startsWith("note-") ? hash.slice(5) : null;
}

function Notes({ notes, book, editions }: { notes: NoteEdit[]; book: CopyBook; editions: Record<string, NoteEdition> }) {
  const long = notes.length >= LONG_GROUP;
  const [all, setAll] = useState(!long);
  const firstNew = useRef<HTMLLIElement>(null);
  const focusNew = useRef(false);
  // A note named in the address that the group draws only once open
  const goTo = useRef<string | null>(null);
  const shown = all ? notes : notes.slice(0, OPEN_AT);
  // The group's notes as one value: the effect below runs when they change, not on every render
  const ids = notes.map((n) => n.id).join(",");

  // A note named in the address comes into view, its group opened first when it hides the note: on load and on a new hash
  useEffect(() => {
    const open = () => {
      const id = hashNote();
      if (!id || !ids.split(",").includes(id)) return;
      const drawn = document.getElementById(noteAnchor(id));
      if (drawn) return drawn.scrollIntoView({ block: "start" });
      goTo.current = id;
      setAll(true);
    };
    const first = requestAnimationFrame(open);
    window.addEventListener("hashchange", open);
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("hashchange", open);
    };
  }, [ids]);

  // Once the group is open: the note named in the address comes into view, or after "Show all" the
  // first new note takes the focus where the button was, without scrolling
  useEffect(() => {
    if (!all) return;
    if (goTo.current) document.getElementById(noteAnchor(goTo.current))?.scrollIntoView({ block: "start" });
    else if (focusNew.current) firstNew.current?.focus({ preventScroll: true });
    goTo.current = null;
    focusNew.current = false;
  }, [all]);

  return (
    <>
      <ul>
        {shown.map((note, i) => (
          <li
            key={note.id}
            id={noteAnchor(note.id)}
            ref={i === OPEN_AT ? firstNew : undefined}
            tabIndex={i === OPEN_AT ? -1 : undefined}
            className="scroll-mt-8 border-t border-glass-border py-5 first:border-t-0 first:pt-0"
          >
            <NoteItemView
              note={note}
              meta={noteMeta(note)}
              controls={<NoteControls note={note} book={book} edition={note.editionId ? (editions[note.editionId] ?? null) : null} />}
            />
          </li>
        ))}
      </ul>
      {!all && (
        <div className="border-t border-glass-border pt-4">
          <button
            type="button"
            onClick={() => {
              focusNew.current = true;
              setAll(true);
            }}
            className="text-xs text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:-my-3.5 pointer-coarse:py-3.5"
            data-notes-show-all=""
          >
            Show all {notes.length}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The book page's "Quotes and notes" (SLN-453), after the Reading section
 * and only when the book has some. Grouped by edition (SLN-480), each group
 * under its edition's heading with its count; one group is named in the
 * section's description instead. A long group opens at its first ten notes
 * (SLN-510).
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
