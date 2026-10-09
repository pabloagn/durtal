import { z } from "zod/v4";
import { timeZoneSchema } from "../reading/dates";
import { cutChapter } from "../reading/reader-progress";

export const MAX_READER_SESSION_BYTES = 8 * 1024;
export const READER_CLOCK_SKEW_MS = 60_000;
const percent = z.number().min(0).max(100).transform((value) => Math.round(value * 100) / 100);

/** Proposed transport contract: the reading binding never comes from source selection. */
export function readerSessionSchema(defaultTimeZone: string) {
  const zone = timeZoneSchema.parse(defaultTimeZone);
  return z.strictObject({
    sittingId: z.uuid(),
    readingId: z.uuid(),
    revision: z.number().int().min(1).max(2_147_483_647),
    startedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
    endedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
    activeSeconds: z.number().int().min(1).max(86_400),
    startPercent: percent,
    endPercent: percent,
    endChapter: z.string().max(2048).nullable().optional().transform(cutChapter),
    goingBack: z.literal("went_back").optional(),
    timeZone: timeZoneSchema.default(zone),
  }).superRefine((value, context) => {
    const wallMs = value.endedAt.getTime() - value.startedAt.getTime();
    if (wallMs < 0) context.addIssue({ code: "custom", path: ["endedAt"], message: "The sitting ends before it starts" });
    // Whole active seconds are floored by the client, never rounded up.
    if (value.activeSeconds * 1000 > wallMs)
      context.addIssue({ code: "custom", path: ["activeSeconds"], message: "Active time exceeds the sitting's elapsed time" });
  });
}

export type ReaderSessionSnapshot = z.output<ReturnType<typeof readerSessionSchema>>;

/** Caller injects the server clock; parsing does not read the environment or database. */
export function parseReaderSession(input: unknown, now: Date, defaultTimeZone: string): ReaderSessionSnapshot {
  const value = readerSessionSchema(defaultTimeZone).parse(input);
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid server clock");
  if (value.endedAt.getTime() > now.getTime() + READER_CLOCK_SKEW_MS)
    throw new Error("This sitting is in the future");
  return value;
}

/** Routes still enforce this bound while reading the stream, before allocating a full body. */
export function parseReaderSessionJson(body: string, now: Date, defaultTimeZone: string): ReaderSessionSnapshot {
  if (new TextEncoder().encode(body).byteLength > MAX_READER_SESSION_BYTES)
    throw new Error("Reader sitting exceeds the request limit");
  return parseReaderSession(JSON.parse(body), now, defaultTimeZone);
}
