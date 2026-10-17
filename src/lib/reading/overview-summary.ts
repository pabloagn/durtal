import { readingControlLabel } from "./labels";
import { formatReadingDate } from "./dates";
import type { BookReadingSummary } from "./overview-types";

/** Same presentation as readingRecord, fed by the complete-history aggregate. */
export function readingRecordFromSummary(summary: BookReadingSummary) {
  const { firstKnown, lastKnownFinished, durationSeconds } = summary.record;
  const hours = Math.floor(durationSeconds / 3600), minutes = Math.round((durationSeconds % 3600) / 60);
  return {
    firstRead: firstKnown ? formatReadingDate(firstKnown.date, firstKnown.precision) : null,
    lastFinished: lastKnownFinished ? formatReadingDate(lastKnownFinished.date, lastKnownFinished.precision) : null,
    timesRead: summary.finishedCount,
    timeSpent: durationSeconds > 0 ? (hours ? `${hours} h ${minutes} min` : `${minutes} min`) : null,
  };
}

/** All-history counts and the latest closed state, with only the visible target's position. */
export function readingControlFromSummary(summary: BookReadingSummary, target: import("./labels").ReadingSummary | null, { ebook = false } = {}): string {
  if (summary.state === "unread") return ebook ? "Unread" : "Start reading";
  if (summary.state === "read") {
    const last = summary.latestFinished;
    const when = last?.precision !== "unknown" ? last?.date : null;
    if (summary.finishedCount === 1) return when && last ? `Read · ${formatReadingDate(when, last.precision)}` : "Read";
    return when ? `Read ${summary.finishedCount} times · ${when.slice(0, 4)}` : `Read ${summary.finishedCount} times`;
  }
  // The bounded overview always includes the open and latest closed targets.
  return target ? readingControlLabel([target], { ebook }) : summary.state === "abandoned" ? "Abandoned" : summary.state === "paused" ? "Paused" : "Reading";
}
