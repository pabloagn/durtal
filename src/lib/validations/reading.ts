import { z } from "zod/v4";
import {
  ABANDON_REASONS,
  READING_DATE_PRECISIONS,
  READING_FORMATS,
  READING_STATUSES,
  READING_UNITS,
} from "@/lib/reading/constants";
import { readingPeriodEnd, timeZoneSchema } from "@/lib/reading/dates";

/*
 * The reading tracker's input rules (SLN-444), shared by the page actions,
 * the internal service, the importers and the REST routes.
 */

export const readingIdSchema = z.uuid();
export const fingerprintSchema = z.string().regex(/^[a-f0-9]{32}$/, "Reload before saving");

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date such as 2019-04-14");
export const precisionSchema = z.enum(READING_DATE_PRECISIONS);
const page = z.number().int().min(0).max(100_000);
const minutes = z.number().int().min(0).max(1_000_000);
const percent = z.number().min(0).max(100);
const total = z.number().int().positive().max(100_000);
const totalMinutes = z.number().int().positive().max(1_000_000);
const chapter = z.string().trim().min(1).max(300);

/** 0.5 to 5.0 in half steps */
export const halfStepRatingSchema = z
  .number()
  .min(0.5, "Rate from 0.5 to 5")
  .max(5, "Rate from 0.5 to 5")
  .refine((n) => Number.isInteger(n * 2), "Rate in half steps");

export const positionSchema = z.object({
  page: page.nullable().optional(),
  percent: percent.nullable().optional(),
  minutes: minutes.nullable().optional(),
  chapter: chapter.nullable().optional(),
});
export type PositionInput = z.infer<typeof positionSchema>;

/** A date and its precision agree: unknown has no date, anything else has one */
function datedPair(date: string | null | undefined, precision: string | undefined) {
  return precision === undefined || (precision === "unknown") === !date;
}

/** The finish period ends on or after the start */
export function finishAfterStart(r: {
  startedOn?: string | null;
  startedPrecision?: string;
  finishedOn?: string | null;
  finishedPrecision?: string;
}) {
  if (!r.startedOn || !r.finishedOn || r.startedPrecision === "unknown" || r.finishedPrecision === "unknown") return true;
  return readingPeriodEnd(r.finishedOn, (r.finishedPrecision ?? "day") as never) >= r.startedOn;
}

const startFields = {
  workId: z.uuid(),
  editionId: z.uuid().nullable().optional(),
  instanceId: z.uuid().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  format: z.enum(READING_FORMATS).optional(),
  unit: z.enum(READING_UNITS).optional(),
  totalPages: total.nullable().optional(),
  totalMinutes: totalMinutes.nullable().optional(),
  startedOn: day.nullable().optional(),
  startedPrecision: precisionSchema.optional(),
  startPage: page.nullable().optional(),
  startPercent: percent.nullable().optional(),
  startMinutes: minutes.nullable().optional(),
  timeZone: timeZoneSchema.optional(),
};

export const startReadingSchema = z
  .object(startFields)
  .refine((r) => datedPair(r.startedOn, r.startedPrecision), "A start date needs its precision, and unknown needs none")
  .refine(
    (r) => [r.startPage, r.startPercent, r.startMinutes].filter((v) => v != null).length <= 1,
    "Give the start as a page, a percent or a time, not more than one",
  );
export type StartReadingInput = z.input<typeof startReadingSchema>;

/** The service's create: the page fields plus the status a new open reading takes */
export const createReadingSchema = z
  .object({ ...startFields, status: z.enum(["reading", "paused"]).optional() })
  .refine((r) => datedPair(r.startedOn, r.startedPrecision), "A start date needs its precision, and unknown needs none")
  .refine(
    (r) => [r.startPage, r.startPercent, r.startMinutes].filter((v) => v != null).length <= 1,
    "Give the start as a page, a percent or a time, not more than one",
  );
export type CreateReadingInput = z.input<typeof createReadingSchema>;

export const goingBackSchema = z.enum(["fix_last_log", "went_back"]);

export const progressSchema = z
  .object({
    readingId: readingIdSchema,
    page: page.nullable().optional(),
    percent: percent.nullable().optional(),
    minutes: minutes.nullable().optional(),
    addPages: z.number().int().positive().max(100_000).optional(),
    addMinutes: z.number().int().positive().max(1_000_000).optional(),
    chapter: chapter.nullable().optional(),
    readOn: day.optional(),
    startedAt: z.coerce.date().optional(),
    endedAt: z.coerce.date().optional(),
    durationSeconds: z.number().int().min(1).max(86_400).optional(),
    note: z.string().trim().max(2000).optional(),
    goingBack: goingBackSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    /** Stops this running timer instead of writing a new session (SLN-451) */
    timerSessionId: z.uuid().optional(),
  })
  .refine(
    (r) =>
      [r.page, r.percent, r.minutes, r.addPages, r.addMinutes].filter((v) => v != null).length <= 1 &&
      // A timer may stop where it started: its time still counts
      (r.timerSessionId !== undefined || [r.page, r.percent, r.minutes, r.addPages, r.addMinutes, r.chapter].some((v) => v != null)),
    "Give one position: a page, a percent, a time, pages or minutes on, or a chapter",
  )
  .refine((r) => !r.startedAt || !r.endedAt || r.endedAt >= r.startedAt, "The session ends before it starts");
export type ProgressInput = z.input<typeof progressSchema>;

export const logProgressSchema = progressSchema.safeExtend({
  fingerprint: fingerprintSchema,
  editionId: z.uuid().nullable().optional(),
  format: z.enum(READING_FORMATS).optional(),
});
export type LogProgressInput = z.input<typeof logProgressSchema>;

export const undoSchema = z.object({
  sessionId: z.uuid(),
  restoreEnd: positionSchema.nullable(),
  repause: z.boolean(),
  timer: z
    .object({ pausedAt: z.string().nullable(), pausedSeconds: z.number().int().min(0).max(86_400), fixedSessionId: z.uuid().nullable() })
    .nullable()
    .optional(),
});
export const undoProgressSchema = z.object({
  readingId: readingIdSchema,
  fingerprint: fingerprintSchema,
  undo: undoSchema,
});

export const statusChangeSchema = z.object({ readingId: readingIdSchema, fingerprint: fingerprintSchema });

const reviewFields = {
  reviewHtml: z.string().max(200_000).nullable().optional(),
  reviewJson: z.unknown().nullable().optional(),
};

export const finishReadingSchema = z
  .object({
    readingId: readingIdSchema,
    fingerprint: fingerprintSchema,
    finishedOn: day.nullable().optional(),
    finishedPrecision: precisionSchema.optional(),
    rating: halfStepRatingSchema.nullable().optional(),
    ...reviewFields,
    setBookRating: z.boolean().optional(),
    timeZone: timeZoneSchema.optional(),
  })
  .refine((r) => datedPair(r.finishedOn, r.finishedPrecision), "A finish date needs its precision, and unknown needs none");

export const abandonReadingSchema = z
  .object({
    readingId: readingIdSchema,
    fingerprint: fingerprintSchema,
    stoppedOn: day.nullable().optional(),
    stoppedPrecision: precisionSchema.optional(),
    reason: z.enum(ABANDON_REASONS),
    note: z.string().trim().max(2000).nullable().optional(),
    page: page.nullable().optional(),
    percent: percent.nullable().optional(),
    minutes: minutes.nullable().optional(),
    timeZone: timeZoneSchema.optional(),
  })
  .refine((r) => datedPair(r.stoppedOn, r.stoppedPrecision), "A date needs its precision, and unknown needs none");

export const reopenReadingSchema = z.object({
  readingId: readingIdSchema,
  fingerprint: fingerprintSchema,
  toStatus: z.enum(["reading", "paused"]).optional(),
  position: positionSchema.nullable().optional(),
  closingSessionId: z.uuid().nullable().optional(),
  restoreBookRating: z
    .object({ before: halfStepRatingSchema.nullable(), after: halfStepRatingSchema.nullable() })
    .nullable()
    .optional(),
});

/** One read written in one go: a past read, an import row, a backfill */
export const writeReadingRowSchema = z
  .object({
    workId: z.uuid(),
    readingId: z.uuid().nullable().optional(),
    editionId: z.uuid().nullable().optional(),
    instanceId: z.uuid().nullable().optional(),
    locationId: z.uuid().nullable().optional(),
    format: z.enum(READING_FORMATS),
    unit: z.enum(READING_UNITS).optional(),
    status: z.enum(READING_STATUSES),
    startedOn: day.nullable().optional(),
    startedPrecision: precisionSchema,
    finishedOn: day.nullable().optional(),
    finishedPrecision: precisionSchema,
    totalPages: total.nullable().optional(),
    totalMinutes: totalMinutes.nullable().optional(),
    position: positionSchema.nullable().optional(),
    rating: halfStepRatingSchema.nullable().optional(),
    ...reviewFields,
    abandonReason: z.enum(ABANDON_REASONS).nullable().optional(),
    abandonNote: z.string().trim().max(2000).nullable().optional(),
    sourceKey: z.string().min(1).max(500).nullable().optional(),
    bookRating: z.enum(["if_none", "replace"]).optional(),
    allowPossibleDuplicate: z.boolean().optional(),
  })
  .refine((r) => datedPair(r.startedOn, r.startedPrecision), "A start date needs its precision, and unknown needs none")
  .refine((r) => datedPair(r.finishedOn, r.finishedPrecision), "A finish date needs its precision, and unknown needs none")
  .refine(finishAfterStart, "The finish date is before the start date")
  .refine(
    (r) => (r.status === "finished" || r.status === "abandoned") || (!r.finishedOn && r.finishedPrecision === "unknown"),
    "An open reading has no finish date",
  )
  .refine((r) => r.status === "abandoned" || (!r.abandonReason && !r.abandonNote), "Only an abandoned read has a reason");
export type WriteReadingRow = z.input<typeof writeReadingRowSchema>;

export const addPastReadingSchema = z
  .object({
    workId: z.uuid(),
    editionId: z.uuid().nullable().optional(),
    instanceId: z.uuid().nullable().optional(),
    locationId: z.uuid().nullable().optional(),
    format: z.enum(READING_FORMATS),
    unit: z.enum(READING_UNITS).optional(),
    totalPages: total.nullable().optional(),
    status: z.enum(["finished", "abandoned"]),
    startedOn: day.nullable().optional(),
    startedPrecision: precisionSchema,
    finishedOn: day.nullable().optional(),
    finishedPrecision: precisionSchema,
    rating: halfStepRatingSchema.nullable().optional(),
    ...reviewFields,
    reason: z.enum(ABANDON_REASONS).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    page: page.nullable().optional(),
    allowPossibleDuplicate: z.boolean().optional(),
  })
  .refine((r) => datedPair(r.startedOn, r.startedPrecision), "A start date needs its precision, and unknown needs none")
  .refine((r) => datedPair(r.finishedOn, r.finishedPrecision), "A finish date needs its precision, and unknown needs none")
  .refine(finishAfterStart, "The finish date is before the start date")
  .refine((r) => r.status === "abandoned" || (!r.reason && !r.note), "Only an abandoned read has a reason");
export type AddPastReadingInput = z.input<typeof addPastReadingSchema>;

export const updateReadingSchema = z
  .object({
    readingId: readingIdSchema,
    fingerprint: fingerprintSchema,
    editionId: z.uuid().nullable().optional(),
    instanceId: z.uuid().nullable().optional(),
    locationId: z.uuid().nullable().optional(),
    format: z.enum(READING_FORMATS).optional(),
    unit: z.enum(READING_UNITS).optional(),
    totalPages: total.nullable().optional(),
    totalMinutes: totalMinutes.nullable().optional(),
    startedOn: day.nullable().optional(),
    startedPrecision: precisionSchema.optional(),
    finishedOn: day.nullable().optional(),
    finishedPrecision: precisionSchema.optional(),
    rating: halfStepRatingSchema.nullable().optional(),
    ...reviewFields,
    abandonReason: z.enum(ABANDON_REASONS).nullable().optional(),
    abandonNote: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type UpdateReadingInput = z.input<typeof updateReadingSchema>;

export const sessionPatchSchema = z
  .object({
    sessionId: z.uuid(),
    fingerprint: fingerprintSchema,
    readOn: day.optional(),
    startedAt: z.coerce.date().nullable().optional(),
    endedAt: z.coerce.date().nullable().optional(),
    durationSeconds: z.number().int().min(1).max(86_400).nullable().optional(),
    end: positionSchema.optional(),
    editionId: z.uuid().nullable().optional(),
    format: z.enum(READING_FORMATS).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    timeZone: timeZoneSchema.optional(),
  })
  .strict();
export type SessionPatchInput = z.input<typeof sessionPatchSchema>;

export const deleteSessionSchema = z.object({ sessionId: z.uuid(), fingerprint: fingerprintSchema });

/* The reading timer and sessions by hand (SLN-451) */

export const startTimerSchema = z.object({ readingId: readingIdSchema, timeZone: timeZoneSchema.optional() });
export const timerSessionSchema = z.object({ sessionId: z.uuid() });

export const stopTimerSchema = z
  .object({
    sessionId: z.uuid(),
    endedAt: z.coerce.date().optional(),
    page: page.nullable().optional(),
    percent: percent.nullable().optional(),
    minutes: minutes.nullable().optional(),
    addPages: z.number().int().positive().max(100_000).optional(),
    chapter: chapter.nullable().optional(),
    editionId: z.uuid().nullable().optional(),
    format: z.enum(READING_FORMATS).optional(),
    goingBack: goingBackSchema.optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((r) => [r.page, r.percent, r.minutes, r.addPages].filter((v) => v != null).length <= 1, "Give one position: a page, a percent, a time or pages on");
export type StopTimerInput = z.input<typeof stopTimerSchema>;

export const undoStopTimerSchema = z.object({ sessionId: z.uuid(), fingerprint: fingerprintSchema, undo: undoSchema });

export const addSessionSchema = z
  .object({
    readingId: readingIdSchema,
    fingerprint: fingerprintSchema,
    readOn: day,
    startedAt: z.coerce.date().nullable().optional(),
    endedAt: z.coerce.date().nullable().optional(),
    durationSeconds: z.number().int().min(1).max(86_400).nullable().optional(),
    to: z.object({ page: page.nullable().optional(), percent: percent.nullable().optional(), minutes: minutes.nullable().optional() }),
    chapter: chapter.nullable().optional(),
    editionId: z.uuid().nullable().optional(),
    format: z.enum(READING_FORMATS).optional(),
    note: z.string().trim().max(2000).optional(),
    timeZone: timeZoneSchema,
  })
  .refine((r) => [r.to.page, r.to.percent, r.to.minutes].filter((v) => v != null).length === 1, "Give where the session ended: a page, a percent or a time")
  .refine((r) => !r.startedAt || !r.endedAt || r.endedAt >= r.startedAt, "The session ends before it starts");
export type AddSessionInput = z.input<typeof addSessionSchema>;

export const restoreSessionSchema = z.object({
  readingId: readingIdSchema,
  fingerprint: fingerprintSchema,
  snapshot: z.record(z.string(), z.unknown()),
});
