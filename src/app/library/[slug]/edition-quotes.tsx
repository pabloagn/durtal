"use client";

import { useOptionalReading } from "@/components/reading/reading-provider";
import { notesCountText } from "@/lib/reading/notes-text";

/**
 * An edition card's Quotes row (SLN-480): the edition's quotes and notes,
 * linked to their group on the book page, and "Add a quote" filed under this
 * edition. The reading defaults to the book's open one, whatever its
 * edition: one read-through may mix editions.
 */
export function EditionQuotes({ editionId, quotes, notes, href }: { editionId: string; quotes: number; notes: number; href: string }) {
  const reading = useOptionalReading();
  if (!reading) return null;
  const count = notesCountText(quotes, notes);
  return (
    <div className="border-b border-glass-border px-5 py-3 text-xs" data-edition-quotes={editionId}>
      <span className="text-fg-secondary">Quotes: </span>
      {count ? (
        <a href={href} className="text-fg-secondary transition-colors hover:text-accent-primary" data-edition-quotes-count="">
          {count}
        </a>
      ) : (
        <span className="text-fg-secondary">No quotes yet</span>
      )}
      <span className="text-fg-secondary"> · </span>
      {/* A text button; 44px tall on touch without moving the row */}
      <button
        type="button"
        onClick={() => reading.open({ kind: "note", noteKind: "quote", editionId, readingId: reading.openRow?.reading.id })}
        className="text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:-my-3.5 pointer-coarse:py-3.5"
        data-edition-quotes-add=""
      >
        Add a quote
      </button>
    </div>
  );
}
