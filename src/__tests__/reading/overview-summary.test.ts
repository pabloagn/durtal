import { describe, expect, it } from "vitest";
import { readingControlFromSummary, readingRecordFromSummary } from "@/lib/reading/overview-summary";
import { emptyReadingSummary } from "@/lib/reading/overview-types";
import type { ReadingSummary } from "@/lib/reading/labels";

describe("complete-history presentation with bounded rows", () => {
  it("retains global dates, finished count and positionless duration", () => {
    const summary = { ...emptyReadingSummary(), finishedCount: 25, record: { firstKnown: { date: "1990-01-01", precision: "year" as const }, lastKnownFinished: { date: "2024-06-01", precision: "month" as const }, durationSeconds: 11520 } };
    expect(readingRecordFromSummary(summary)).toEqual({firstRead:"1990",lastFinished:"Jun 2024",timesRead:25,timeSpent:"3 h 12 min"});
  });
  it("uses the global finished count even when only four rows are displayed", () => {
    const summary = { ...emptyReadingSummary(), state: "read" as const, finishedCount: 25, latestFinished: { date:"2024-06-01",precision:"month" as const } };
    expect(readingControlFromSummary(summary,null)).toBe("Read 25 times · 2024");
  });
  it("keeps the latest abandonment resumable despite older finishes", () => {
    const target: ReadingSummary = {id:"latest",status:"abandoned",unit:"pages",currentPage:120,currentPercent:25,currentMinutes:null,totalPages:480,totalMinutes:null,finishedOn:"2024-01-01",finishedPrecision:"year"};
    expect(readingControlFromSummary({...emptyReadingSummary(),state:"abandoned",finishedCount:9},target)).toBe("Abandoned at p. 120");
  });
});
