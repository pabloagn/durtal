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

/** A passage he keeps, or his own note (SLN-453) */
export const NOTE_KINDS = ["quote", "note"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
/** Where a quote or note came from */
export const NOTE_SOURCES = ["manual", "reader", "import"] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number];
/** The longest passage or note, in characters */
export const NOTE_MAX = 10_000;

/** What a reading goal counts (SLN-455) */
export const GOAL_METRICS = ["books", "pages", "hours"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

/**
 * Suggestion feedback (SLN-457; the parent's `recommendation_feedback`,
 * shared with the book enrichment epic): Not now (until a date), Never, and
 * Not for me with reasons. Nothing else lists the reason codes.
 */
export const FEEDBACK_VERDICTS = ["not_now", "never", "rejected"] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];
export const FEEDBACK_SOURCES = ["suggestions", "agent", "enrichment"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];
export const FEEDBACK_REASONS = ["too_long", "too_short", "not_in_the_mood", "prose", "genre", "too_popular", "already_read", "other"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  too_long: "Too long",
  too_short: "Too short",
  not_in_the_mood: "Not in the mood",
  prose: "The prose",
  genre: "Not my kind of book",
  too_popular: "Too popular",
  already_read: "Already read it",
  other: "Other",
};
/** The longest feedback note, in characters */
export const FEEDBACK_NOTE_MAX = 500;

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

/** The format of a book's copies when they all read in one; print otherwise, or with no copy (SLN-463's Mark as read) */
export function formatOfCopies(copyFormats: (string | null | undefined)[]): ReadingFormat {
  const formats = new Set(copyFormats.map(formatOfCopy));
  return formats.size === 1 ? [...formats][0] : "print";
}
