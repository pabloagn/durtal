/*
 * The command palette's Reading group (SLN-448). Pure: what was typed and the
 * open readings in, the items out. Every item carries its reading's
 * fingerprint, so the dialog it opens saves only against the reading the
 * palette saw.
 */
import type { ReadingUnit } from "./constants";
import { formatMinutes, parseProgressInput, type ProgressInput } from "./positions";

export interface PaletteOpenReading {
  reading: {
    id: string;
    workId: string;
    unit: ReadingUnit;
    totalPages: number | null;
    totalMinutes: number | null;
  };
  fingerprint: string;
  work: { id: string; title: string };
}

export interface PaletteReadingItem {
  /** The palette row's value: unique */
  value: string;
  label: string;
  /** The Log progress dialog to open, prefilled with what was typed */
  request: { kind: "progress"; workId: string; readingId: string; fingerprint: string; prefill?: string };
  /** What the typed text means for this reading; "+20" stays relative (addPages) */
  input?: ProgressInput;
}

/** "p. 212", "44%", "3:12", "+20 pages", "+15 min" */
export function progressWords(input: ProgressInput): string | null {
  if (input.kind === "page") return `p. ${input.page}`;
  if (input.kind === "percent") return `${input.percent}%`;
  if (input.kind === "minutes") return formatMinutes(input.minutes);
  if (input.kind === "addPages") return `+${input.pages} ${input.pages === 1 ? "page" : "pages"}`;
  if (input.kind === "addMinutes") return `+${input.minutes} min`;
  return null;
}

/**
 * The palette's reading items. `smart`: when the query is a position ("212",
 * "44%", "+20", "3:12") that fits a reading, one "Log p. 212 · Title" per such
 * reading; they come first. A chapter is never read from the query, since a
 * search for "Chekhov" would read as chapter "ekhov". `log`: one "Log progress ·
 * Title" per open reading.
 */
export function paletteReadingItems(query: string, openReadings: PaletteOpenReading[]) {
  const typed = query.trim();
  const smart: PaletteReadingItem[] = [];
  const log: PaletteReadingItem[] = [];
  for (const open of openReadings) {
    const r = open.reading;
    const base = { kind: "progress" as const, workId: open.work.id, readingId: r.id, fingerprint: open.fingerprint };
    log.push({ value: `reading-log:${r.id}`, label: `Log progress · ${open.work.title}`, request: base });
    // Only what starts like a position: a digit, "+", or "p 212" / "page 212"
    if (!/^[+\d]|^p(?:age|g|\.)?\s?\d/i.test(typed)) continue;
    const parsed = parseProgressInput(typed, { unit: r.unit, totalPages: r.totalPages, totalMinutes: r.totalMinutes });
    if (!parsed.ok) continue;
    const words = progressWords(parsed.value);
    if (!words) continue;
    smart.push({
      value: `reading-smart:${r.id}`,
      label: `Log ${words} · ${open.work.title}`,
      request: { ...base, prefill: typed },
      input: parsed.value,
    });
  }
  return { smart, log };
}
