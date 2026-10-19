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
