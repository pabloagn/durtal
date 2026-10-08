"use client";

import Link from "next/link";
import { SectionHeading } from "@/components/shared/section-heading";
import type { NoteEdit } from "@/lib/actions/reading-notes";
import type { NoteEdition } from "@/lib/reading/edition-label";
import { ordinalRead } from "@/lib/reading/labels";
import { noteWhereText } from "@/lib/reading/notes-text";
import { NoteControls } from "./note-controls";
import { NoteItemView } from "./note-item";

/** One note of the commonplace book, with its book */
export type NotesListRow = NoteEdit & { book: { id: string; title: string; href: string; author: string | null } };

/** "p. 212 · Penguin Classics, 2003 · ch. 7 · 2nd read · Note"; with `withBook`, the book's title (a link) and author first */
function meta(note: NotesListRow, withBook: boolean, edition: NoteEdition | null) {
  const where = [noteWhereText(note, edition), note.readingOrdinal ? ordinalRead(note.readingOrdinal) : null, note.kind === "note" ? "Note" : null]
    .filter(Boolean)
    .join(" · ");
  if (!withBook) return where;
  return (
    <>
      <Link href={note.book.href} className="text-fg-primary transition-colors hover:text-accent-primary">
        {note.book.title}
      </Link>
      {[note.book.author, where].filter(Boolean).map((part) => ` · ${part}`)}
    </>
  );
}

function Items({ rows, withBook, editions }: { rows: NotesListRow[]; withBook: boolean; editions: Record<string, NoteEdition> }) {
  return (
    <ul>
      {rows.map((note) => {
        const edition = note.editionId ? (editions[note.editionId] ?? null) : null;
        return (
          <li key={note.id} className="border-t border-glass-border py-5 first:border-t-0 first:pt-0">
            <NoteItemView note={note} meta={meta(note, withBook, edition)} controls={<NoteControls note={note} book={note.book} edition={edition} />} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The commonplace book's list (SLN-453), drawn in the browser from slim
 * rows: a server-drawn list would send each note twice, as markup and as its
 * controls' data. By book: grouped under each book's title and author.
 * Each edition comes once, in `editions` (SLN-480).
 */
export function NotesList({ rows, byBook, editions }: { rows: NotesListRow[]; byBook: boolean; editions: Record<string, NoteEdition> }) {
  if (!byBook) return <Items rows={rows} withBook editions={editions} />;
  const groups: { book: NotesListRow["book"]; rows: NotesListRow[] }[] = [];
  for (const row of rows) {
    if (groups.at(-1)?.book.id !== row.book.id) groups.push({ book: row.book, rows: [] });
    groups.at(-1)!.rows.push(row);
  }
  return (
    <div className="space-y-10">
      {groups.map((group, i) => (
        <section key={`${group.book.id}-${i}`} data-notes-book={group.book.id}>
          <SectionHeading
            as="h3"
            title={
              <Link href={group.book.href} className="transition-colors hover:text-accent-primary">
                {group.book.title}
              </Link>
            }
            description={group.book.author ?? undefined}
          />
          <Items rows={group.rows} withBook={false} editions={editions} />
        </section>
      ))}
    </div>
  );
}
