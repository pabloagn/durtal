import type { ReadingDatePrecision, ReadingStatus } from "./constants";
import type { BookReadingState } from "./labels";

export const BOOK_HISTORY_LIMIT = 4;
export const HUB_OPEN_LIMIT = 8;
export const READING_CHOICE_PAGE_SIZE = 20;

export interface ReadingDateValue { date: string; precision: ReadingDatePrecision }
export interface ReadingRatingPoint { rating: number; ordinal: number; year: string | null }
export interface BookReadingSummary {
  readingCount: number;
  openCount: number;
  finishedCount: number;
  abandonedCount: number;
  sessionCount: number;
  state: BookReadingState;
  openReadingId: string | null;
  latestClosedId: string | null;
  latestClosedStatus: ReadingStatus | null;
  latestFinished: ReadingDateValue | null;
  record: { firstKnown: ReadingDateValue | null; lastKnownFinished: ReadingDateValue | null; durationSeconds: number };
  ratings: { count: number; preview: ReadingRatingPoint[]; hasMore: boolean };
}
export interface ReadingStartDefaults {
  lastEditionId: string | null;
  latestMinutesByEdition: Record<string, number>;
}
export interface ReadingChoice {
  id: string;
  ordinal: number;
  status: ReadingStatus;
  editionId: string | null;
  editionLabel: string | null;
  unit: "pages" | "percent" | "minutes";
  currentPage: number | null;
  currentPercent: number | null;
  currentChapter: string | null;
  startedOn: string | null;
  startedPrecision: ReadingDatePrecision;
  finishedOn: string | null;
  finishedPrecision: ReadingDatePrecision;
}
export interface ReadingChoicePage { items: ReadingChoice[]; total: number; page: number; hasNext: boolean }
export const emptyReadingSummary = (): BookReadingSummary => ({
  readingCount: 0, openCount: 0, finishedCount: 0, abandonedCount: 0, sessionCount: 0,
  state: "unread", openReadingId: null, latestClosedId: null, latestClosedStatus: null, latestFinished: null,
  record: { firstKnown: null, lastKnownFinished: null, durationSeconds: 0 },
  ratings: { count: 0, preview: [], hasMore: false },
});
export const emptyStartDefaults = (): ReadingStartDefaults => ({ lastEditionId: null, latestMinutesByEdition: {} });
