"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Prose } from "@/components/shared/prose";
import { SectionHeading } from "@/components/shared/section-heading";
import { getPassageOfTheDay, type NoteWithBook } from "@/lib/actions/reading-notes";
import type { NoteEdition } from "@/lib/reading/edition-label";
import { noteWhereText } from "@/lib/reading/notes-text";
import { showError } from "./reading-client";

/** A passage longer than this opens clamped, with "Show all" */
const LONG = 600;

/**
 * The hub's passage of the day (SLN-453): one of his quotes, the same all
 * day on every device. "Another" steps to the next one in the same order, in
 * this browser only; tomorrow's passage does not change. Its line names the
 * edition (SLN-480): "Title · Author · p. 212 · Penguin Classics, 2003 · ch. 7".
 */
export function PassageOfTheDay({
  day,
  initial,
  initialEdition,
  candidates,
}: {
  day: string;
  initial: NoteWithBook;
  initialEdition: NoteEdition | null;
  candidates: number;
}) {
  const [note, setNote] = useState(initial);
  const [edition, setEdition] = useState(initialEdition);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(false);
  const long = note.body.length > LONG;

  async function another() {
    setLoading(true);
    try {
      const next = await getPassageOfTheDay({ day, offset: offset + 1 });
      if (next) {
        setNote(next.note);
        setEdition(next.edition);
        setOffset(offset + 1);
        setAll(false);
      }
    } catch (err) {
      showError(err, () => undefined);
    } finally {
      setLoading(false);
    }
  }

  const where = noteWhereText(note, edition);
  return (
    <section data-hub-passage="">
      <SectionHeading
        title="Passage of the day"
        action={
          candidates > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => void another()} disabled={loading} className="pointer-coarse:h-11" data-hub-passage-another="">
              Another
            </Button>
          ) : undefined
        }
      />
      <figure data-note={note.id}>
        <blockquote className="border-l-2 border-accent-primary/40 pl-4" aria-live="polite">
          <Prose className={long && !all ? "line-clamp-8" : ""}>
            <p className="whitespace-pre-line break-words">{note.body}</p>
          </Prose>
        </blockquote>
        <figcaption className="mt-2 pl-4.5 text-xs text-fg-secondary">
          <Link href={`/library/${note.book.slug ?? note.book.id}`} className="text-fg-primary transition-colors hover:text-accent-primary">
            {note.book.title}
          </Link>
          {[note.book.author, where].filter(Boolean).map((part) => ` · ${part}`)}
          {long && (
            <>
              {" · "}
              <button type="button" onClick={() => setAll(!all)} className="text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline pointer-coarse:-my-3.5 pointer-coarse:py-3.5">
                {all ? "Show less" : "Show all"}
              </button>
            </>
          )}
        </figcaption>
      </figure>
    </section>
  );
}
