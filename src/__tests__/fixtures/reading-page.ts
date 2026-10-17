import type { ReadingPageData } from "@/components/reading/reading-client";
import { bookReadingState } from "@/lib/reading/labels";
import { emptyReadingSummary } from "@/lib/reading/overview-types";

/** Existing UI fixtures contain their whole history; make the new wire contract explicit. */
export function readingPageFixture(value: unknown): ReadingPageData {
  const data = value as ReadingPageData;
  const rows = data.rows ?? [];
  const readings = rows.map(row => row.reading);
  return { ...data,
    summary: data.summary ?? { ...emptyReadingSummary(), readingCount: rows.length,
      openCount: readings.filter(row => row.status === "reading" || row.status === "paused").length,
      finishedCount: readings.filter(row => row.status === "finished").length,
      sessionCount: rows.reduce((sum, row) => sum + (row.sessionCount ?? 0), 0), state: bookReadingState(readings),
      latestClosedId: readings.find(row => row.status === "finished" || row.status === "abandoned")?.id ?? null },
    defaults: data.defaults ?? { lastEditionId: readings.find(row => row.editionId)?.editionId ?? null,
      latestMinutesByEdition: Object.fromEntries([...readings].reverse().filter(row => row.editionId && row.totalMinutes).map(row => [row.editionId, row.totalMinutes])) },
    history: data.history ?? { closedCount: readings.filter(row => row.status === "finished" || row.status === "abandoned").length, hasMore: false },
  };
}
