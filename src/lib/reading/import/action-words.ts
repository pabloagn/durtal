/*
 * The words of the import's buttons (SLN-956): pure, for the client islands
 * and their tests. Counts are plural by number.
 */

const many = (count: number, one: string, more = `${one}s`) => `${count} ${count === 1 ? one : more}`;

/** "Accept all likely matches" and "Skip all not in Durtal": "1 row changed", "12 rows changed" */
export const rowsChanged = (count: number) => `${many(count, "row")} changed`;

/** What Undo removes; the Goodreads ids only when the import recorded some */
export function undoRemoves({ readings, queued = 0, notes = 0, goodreadsIds = 0 }: { readings: number; queued?: number; notes?: number; goodreadsIds?: number }): string[] {
  return [
    readings ? `the ${readings === 1 ? "reading" : `${readings} readings`} it wrote` : null,
    queued ? `the ${queued === 1 ? "book" : `${queued} books`} it added to Up next` : null,
    notes ? `the ${notes === 1 ? "note" : `${notes} notes`} it imported` : null,
    "the book ratings it set while they are unchanged",
    goodreadsIds ? `the ${goodreadsIds === 1 ? "Goodreads id" : `${goodreadsIds} Goodreads ids`} it recorded` : null,
  ].filter((part): part is string => part !== null);
}


/** Both import pages use the same availability rule, including an interrupted first phase. */
export function canUndoImport(counts: { readings?: number; queued?: number; notes?: number; sessions?: number; ratings?: number; identifiers?: number; pendingClaims?: number }): boolean {
  return [counts.readings, counts.sessions, counts.queued, counts.notes, counts.ratings, counts.identifiers, counts.pendingClaims].some((count) => (count ?? 0) > 0);
}

/** Claims can be reused metadata, so clearing their journal need not remove any record. */
export function undoDescription(counts: { readings: number; queued?: number; notes?: number; goodreadsIds?: number; pendingClaims?: number; ratings?: number; sessions?: number }): string {
  if (counts.sessions) return `Undo removes the ${counts.sessions} restored sessions only while their complete contents and parent are unchanged. Edited sessions and current reading progress are kept.`;
  const { readings, queued = 0, notes = 0, goodreadsIds = 0, pendingClaims = 0, ratings = 0 } = counts;
  if (pendingClaims && !readings && !queued && !notes && !ratings) {
    return "No readings, notes or Up next items were written. Undo clears this import’s pending ID claims. " +
      (goodreadsIds ? "Only new IDs still owned by this import and unused elsewhere are removed; reused, moved or shared IDs are kept." : "Reused Goodreads IDs are kept.");
  }
  const removes = undoRemoves(counts);
  const list = removes.length > 1 ? `${removes.slice(0, -1).join(", ")}, and ${removes.at(-1)}` : removes[0];
  return `This removes ${list}. Readings${notes ? " and notes" : ""} you edited since, and Up next items you moved or edited, are kept. ` +
    (goodreadsIds ? "Moved, shared or reused Goodreads IDs are kept. " : "") + "You can import it again later.";
}

/** The result names only the entities the action actually changed or found. */
export function commitResultWords(counts: { written: number; present: number; refused: number; queued: number; notes: number; sessions?: number; sessionsPresent?: number; notesPresent?: number }): string {
  return [
    counts.written ? `${many(counts.written,"reading")} written` : null,
    counts.sessions ? `${many(counts.sessions,"session")} restored` : null,
    counts.notes ? `${many(counts.notes,"note")} imported` : null,
    counts.present ? `${many(counts.present,"reading")} already in Durtal` : null,
    counts.sessionsPresent ? `${many(counts.sessionsPresent,"session")} already in Durtal` : null,
    counts.notesPresent ? `${many(counts.notesPresent,"note")} already in Durtal` : null,
    counts.queued ? `${many(counts.queued,"book")} added to Up next` : null,
    counts.refused ? `${counts.refused} refused` : null,
  ].filter(Boolean).join(" · ") || "Nothing new to import";
}
