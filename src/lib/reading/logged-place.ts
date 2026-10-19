import type { ReaderTrackingData } from "@/lib/reading/reader-tracking-data";
import { formatPercent } from "@/lib/reader/place-label";

export type LoggedReading = NonNullable<NonNullable<ReaderTrackingData["linked"]>["reading"]>;

/** How far ahead of the reader the logged place must be for the jump to show:
 * more than a page of the logged edition, or 1% without its page count */
export function loggedPlaceAhead(reading: LoggedReading | null | undefined, readerPercent: number | null): boolean {
  if (reading?.percent == null || readerPercent == null) return false;
  const page = reading.totalPages ? 100 / reading.totalPages : 1;
  return reading.percent - readerPercent > page;
}
/** "p. 120", the page logged in the edition, or its share of the book when it
 * was logged without one */
export function loggedPlaceWhere(reading: LoggedReading): string {
  return reading.page != null ? `p. ${reading.page}` : formatPercent(reading.percent ?? 0);
}
export function loggedPlaceLabel(reading: LoggedReading): string {
  return `Jump to ${loggedPlaceWhere(reading)}`;
}

// "Stay at this place" holds for the tab's visit, so a reload doesn't offer the
// jump again; a later logged place is another place, and offers it (SLN-1179)
const STAYED_KEY = "durtal-reader-stayed";
/** The logged place the jump was dismissed or taken at for a reading in this tab */
export function stayedAt(readingId: string): number | null {
  try {
    const value = sessionStorage.getItem(`${STAYED_KEY}:${readingId}`);
    const at = value === null ? NaN : Number(value);
    return Number.isFinite(at) ? at : null;
  } catch {
    // Blocked storage: the jump is offered again on a reload, as before
    return null;
  }
}
export function keepStayedAt(readingId: string, at: number): void {
  try {
    sessionStorage.setItem(`${STAYED_KEY}:${readingId}`, String(at));
  } catch {
    // Blocked or full storage: the dismissal holds until the page reloads
  }
}
