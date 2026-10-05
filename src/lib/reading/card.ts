/*
 * A book card's reading (SLN-449): only an open reading's state and percent,
 * so 48 cards cost a few bytes each. Pure: the card, the mappers and their
 * tests share it.
 */

export interface CardReadingValue {
  state: "reading" | "paused";
  percent: number | null;
}

/** The card field from the library query's extras; nothing unless a reading is open */
export function cardReadingOf(row: { readingState?: string | null; readingPercent?: number | null }): CardReadingValue | undefined {
  if (row.readingState !== "reading" && row.readingState !== "paused") return undefined;
  return { state: row.readingState, percent: row.readingPercent ?? null };
}

/** "Reading 44%", "Paused 44%", or "Reading" with no percent */
export function cardReadingLabel(reading: CardReadingValue) {
  const word = reading.state === "reading" ? "Reading" : "Paused";
  return reading.percent === null ? word : `${word} ${Math.round(reading.percent)}%`;
}

/** The status tooltip with the reading: "Accessioned · High priority · 2 copies · Reading, 44%" */
export function cardReadingTooltip(statusTooltip: string, reading: CardReadingValue) {
  const word = reading.state === "reading" ? "Reading" : "Paused";
  const part = reading.percent === null ? word : `${word}, ${Math.round(reading.percent)}%`;
  return statusTooltip ? `${statusTooltip} · ${part}` : part;
}

/** A book's reading in the library list and table, from `getReadingSummaries` */
export interface ReadingSummaryValue {
  state: "unread" | "reading" | "paused" | "read" | "abandoned";
  timesRead: number;
  lastFinishedOn: string | null;
  lastFinishedPrecision: string | null;
  lastReadAt: string | null;
  percent: number | null;
}

/**
 * The list row's reading badge: "Reading 44%" (blue), "Paused 44%" (muted),
 * "Read" or "Read 3×" (sage), "Abandoned" (muted); nothing for an unread
 * book. Before the summaries load, the card field gives the open reading.
 */
export function readingBadge(
  summary: Pick<ReadingSummaryValue, "state" | "timesRead" | "percent"> | undefined,
  reading?: CardReadingValue,
): { label: string; variant: "blue" | "sage" | "muted" } | null {
  const state = summary?.state ?? reading?.state;
  if (state === "reading" || state === "paused") {
    const percent = summary ? summary.percent : (reading?.percent ?? null);
    return { label: cardReadingLabel({ state, percent }), variant: state === "reading" ? "blue" : "muted" };
  }
  if (state === "read") return { label: summary && summary.timesRead > 1 ? `Read ${summary.timesRead}×` : "Read", variant: "sage" };
  if (state === "abandoned") return { label: "Abandoned", variant: "muted" };
  return null;
}
