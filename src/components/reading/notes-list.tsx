"use client";

import Link from "next/link";
import { SectionHeading } from "@/components/shared/section-heading";
import type { NoteEdit } from "@/lib/actions/reading-notes";
import { ordinalRead } from "@/lib/reading/labels";
import { noteWhereText } from "@/lib/reading/notes-text";
import { NoteControls } from "./note-controls";
import { NoteItemView } from "./note-item";

/** One note of the commonplace book, with its book */
export type NotesListRow = NoteEdit & { book: { id: string; title: string; href: string; author: string | null } };

/** "p. 212 · 2nd read · Note"; with `withBook`, the book's title (a link) and author first */
function meta(note: NotesListRow, withBook: boolean) {
  const where = [noteWhereText(note), note.readingOrdinal ? ordinalRead(note.readingOrdinal) : null, note.kind === "note" ? "Note" : null]
    .filter(Boolean)
    .join(" · ");
  if (!withBook) return where;
  return (
    <>
      <Link href={note.book.href} className="text-fg-primary transition-colors hover:text-accent-rose-text">
        {note.book.title}
      </Link>
      {[note.book.author, where].filter(Boolean).map((part) => ` · ${part}`)}
    </>
  );
}

function Items({ rows, withBook }: { rows: NotesListRow[]; withBook: boolean }) {
  return (
    <ul>
      {rows.map((note) => (
        <li key={note.id} className="border-t border-glass-border py-5 first:border-t-0 first:pt-0">
          <NoteItemView note={note} meta={meta(note, withBook)} controls={<NoteControls note={note} book={note.book} />} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The commonplace book's list (SLN-453), drawn in the browser from slim
 * rows: a server-drawn list would send each note twice, as markup and as its
 * controls' data. By book: grouped under each book's title and author.
 */
export function NotesList({ rows, byBook }: { rows: NotesListRow[]; byBook: boolean }) {
  if (!byBook) return <Items rows={rows} withBook />;
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
              <Link href={group.book.href} className="transition-colors hover:text-accent-rose-text">
                {group.book.title}
              </Link>
            }
            description={group.book.author ?? undefined}
          />
          <Items rows={group.rows} withBook={false} />
        </section>
      ))}
    </div>
  );
}
