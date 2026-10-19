"use client";

import { useOptionalReading } from "@/components/reading/reading-provider";
import { notesCountText } from "@/lib/reading/notes-text";
import { SectionHeading } from "@/components/shared/section-heading";

/**
 * An edition card's Quotes group (SLN-480): the edition's quotes and notes,
 * linked to their group on the book page, and "Add a quote" filed under this
 * edition, both text commands (SLN-693). The reading defaults to the book's
 * open one, whatever its edition: one read-through may mix editions.
 *
 * An edition with no quotes and no copies (`bare`) folds both into the
 * card's last line, so a phone's list of editions is not mostly empty
 * sections (SLN-1132); the card then leaves out its Copies.
 */
export function EditionQuotes({ editionId, quotes, notes, href, bare = false }: { editionId: string; quotes: number; notes: number; href: string; bare?: boolean }) {
  const reading = useOptionalReading();
  if (!reading) return null;
  const count = notesCountText(quotes, notes);
  const add = (
    <button
      type="button"
      onClick={() => reading.open({ kind: "note", noteKind: "quote", editionId, readingId: reading.openRow?.reading.id })}
      className="text-command"
      data-edition-quotes-add=""
    >
      Add a quote
    </button>
  );
  if (bare && !count)
    return (
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 px-5 py-3 text-xs" data-edition-quotes={editionId}>
        <span className="text-fg-secondary">No quotes or copies yet</span>
        {add}
      </div>
    );
  return (
    <div className="border-b border-glass-border px-5 py-4" data-edition-quotes={editionId}>
      <SectionHeading as="h4" title="Quotes" />
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 text-xs">
        {count ? (
          <a href={href} className="text-command" data-edition-quotes-count="">
            {count}
          </a>
        ) : (
          <span className="text-fg-secondary">No quotes yet</span>
        )}
        {add}
      </div>
    </div>
  );
}
