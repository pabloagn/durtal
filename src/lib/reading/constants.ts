/*
 * The reading tracker's vocabulary (SLN-444). A reading is one read-through
 * of a book; its status moves only along READING_TRANSITIONS. Not a
 * "use server" file: pages, services and tests share it.
 */

export const READING_STATUSES = ["reading", "paused", "finished", "abandoned"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

export const READING_FORMATS = ["print", "ebook", "audio"] as const;
export type ReadingFormat = (typeof READING_FORMATS)[number];

export const READING_UNITS = ["pages", "percent", "minutes"] as const;
export type ReadingUnit = (typeof READING_UNITS)[number];

export const READING_DATE_PRECISIONS = ["day", "month", "year", "unknown"] as const;
export type ReadingDatePrecision = (typeof READING_DATE_PRECISIONS)[number];

export const ABANDON_REASONS = [
  "lost_interest",
  "prose",
  "content",
  "edition",
  "translation",
  "superseded",
  "other",
] as const;
export type AbandonReason = (typeof ABANDON_REASONS)[number];
export const ABANDON_REASON_LABELS: Record<AbandonReason, string> = {
  lost_interest: "Lost interest",
  prose: "The prose",
  content: "The content",
  edition: "This edition",
  translation: "This translation",
  superseded: "Read another version",
  other: "Other",
};

/** Where a reading came from: made in the app, by the reader, imported, backfilled */
export const READING_SOURCES = ["manual", "reader", "import", "backfill"] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

export const SESSION_SOURCES = ["manual", "timer", "reader", "import"] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

/** Where an Up Next item came from (SLN-452) */
export const QUEUE_SOURCES = ["manual", "import", "suggestion"] as const;
export type QueueSource = (typeof QUEUE_SOURCES)[number];
/** The gap between Up Next positions: a move between two items takes the middle */
export const QUEUE_GAP = 1024;

/** A book's reading state, derived from its readings */
export const WORK_READING_STATES = ["unread", "reading", "paused", "read", "abandoned"] as const;
export type WorkReadingState = (typeof WORK_READING_STATES)[number];
export const WORK_READING_STATE_LABELS: Record<WorkReadingState, string> = {
  unread: "Unread",
  reading: "Reading",
  paused: "Paused",
  read: "Read",
  abandoned: "Abandoned",
};

export const OPEN_READING_STATUSES = ["reading", "paused"] as const satisfies readonly ReadingStatus[];

/**
 * The allowed status changes. `null` is a new reading: started or paused by
 * `createReading`, or written as a past read (finished or abandoned) by
 * `writeReadings`.
 */
export const READING_TRANSITIONS: readonly { from: ReadingStatus | null; to: readonly ReadingStatus[] }[] = [
  { from: null, to: ["reading", "paused", "finished", "abandoned"] },
  { from: "reading", to: ["paused", "finished", "abandoned"] },
  { from: "paused", to: ["reading", "finished", "abandoned"] },
  { from: "finished", to: ["reading", "paused"] },
  { from: "abandoned", to: ["reading", "paused"] },
];

export function canTransition(from: ReadingStatus | null, to: ReadingStatus) {
  return READING_TRANSITIONS.some((t) => t.from === from && t.to.includes(to));
}

export function isOpenStatus(status: ReadingStatus) {
  return status === "reading" || status === "paused";
}

/** The format a copy is read in: e-book files are e-books, audiobooks audio, the rest print */
export function formatOfCopy(copyFormat: string | null | undefined): ReadingFormat {
  if (!copyFormat) return "print";
  if (["ebook", "epub", "pdf"].includes(copyFormat)) return "ebook";
  if (copyFormat === "audiobook") return "audio";
  return "print";
}
