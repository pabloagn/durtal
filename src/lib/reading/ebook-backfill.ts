import { readingDay } from "./dates";
import { readerReadingKey } from "./source-keys";
import { fractionToPercent, isReaderEnd } from "./reader-progress";
import type { WriteReadingRow } from "../validations/reading";

export interface LegacyReaderHistory {
  progressPercent: number | null;
  startedAt: Date | null;
  lastReadAt: Date | null;
  finishedAt: Date | null;
}
export interface BackfillContext {
  ebookId: string;
  workId: string;
  editionId: string;
  instanceId: string;
  totalPages: number | null;
  now: Date;
  timeZone: string;
  dayStartHour: number;
  hasOpenReading: boolean;
}
export interface EbookReadingProposal {
  reading: WriteReadingRow;
  selected: boolean;
  reason: "finished" | "end_without_finish" | "recent" | "paused" | "low_or_old" | "already_open";
  canImport: boolean;
}

/** No I/O and no invented finish date; dates use the application's reading day. */
export function proposeEbookReading(progress: LegacyReaderHistory, context: BackfillContext): EbookReadingProposal {
  const percent = fractionToPercent(progress.progressPercent ?? 0);
  const day = (at: Date | null) => at ? readingDay(at, context.timeZone, context.dayStartHour) : null;
  const age = progress.lastReadAt ? context.now.getTime() - progress.lastReadAt.getTime() : Infinity;
  const yearAgo = new Date(context.now);
  // Calendar-year boundary, rather than a 365-day approximation around leap years.
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const old = !progress.lastReadAt || progress.lastReadAt < yearAgo;
  const lowOrOld = percent < 5 || old;
  const finished = progress.finishedAt !== null || isReaderEnd(percent);
  const reason = progress.finishedAt ? "finished" : finished ? "end_without_finish"
    : lowOrOld ? "low_or_old" : age < 30 * 86_400_000 ? "recent" : "paused";
  const status = finished ? "finished" : reason === "recent" ? "reading" : "paused";
  const startedOn = day(progress.startedAt);
  const finishedOn = day(progress.finishedAt);
  const blocked = !finished && context.hasOpenReading;
  return {
    reading: {
      workId: context.workId, editionId: context.editionId, instanceId: context.instanceId,
      format: "ebook", unit: "percent", totalPages: context.totalPages,
      status, startedOn, startedPrecision: startedOn ? "day" : "unknown",
      finishedOn, finishedPrecision: finishedOn ? "day" : "unknown",
      position: { percent }, sourceKey: readerReadingKey(context.ebookId),
    },
    selected: !blocked && (reason === "finished" || reason === "recent" || reason === "paused"),
    reason: blocked ? "already_open" : reason,
    canImport: !blocked,
  };
}
