import { QUEUE_GAP, type ReadingFormat } from "./constants";
import { pickDefaultEdition, type EditionChoice } from "./defaults";
import { copyWhereabouts, isAtHand, type CopyPlace } from "./at-hand";
import { DEFAULT_PAGES_PER_HOUR, hoursWords, priorFor, type PacePriors } from "./pace";

/*
 * Up Next (SLN-452), pure: positions with gaps, the edition and copy of each
 * item, and the time the list would take at his pace. getQueue reads the
 * rows; these decide what they say.
 */

/** The position between two neighbours (null above the top or below the bottom); null when no gap is left */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return QUEUE_GAP;
  if (before === null) return after! - QUEUE_GAP;
  if (after === null) return before + QUEUE_GAP;
  if (after - before < 2) return null;
  return Math.floor((before + after) / 2);
}

/** Every position again, in steps of QUEUE_GAP, in the given order */
export function renumbered<T>(items: T[]): { item: T; position: number }[] {
  return items.map((item, i) => ({ item, position: (i + 1) * QUEUE_GAP }));
}

export interface QueueCopy extends CopyPlace {
  id: string;
  format: string | null;
}

export interface QueueEdition extends EditionChoice {
  title: string | null;
  language: string | null;
  thumbnail: string | null;
  /** The total_minutes of the latest reading of this edition that has one */
  audioMinutes: number | null;
  copies: QueueCopy[];
}

/** The edition he means to read: the queued one, else the Start dialog's default for the home */
export function queueEdition(editions: QueueEdition[], queuedId: string | null, homeId: string | null): QueueEdition | null {
  const queued = queuedId ? editions.find((e) => e.id === queuedId) : undefined;
  if (queued) return queued;
  const pick = pickDefaultEdition(editions, { homeId, lastReadingEditionId: null });
  return editions.find((e) => e.id === pick.editionId) ?? null;
}

const heldFirst = (copies: QueueCopy[]) =>
  copies.filter((c) => c.status !== "deaccessioned").sort((a, b) => Number(b.status === "available") - Number(a.status === "available"));

/** Where the book's copy is: the copy at hand at the home, else its first copy held, else "Not owned" */
export function queueWhereabouts(editions: QueueEdition[], atHandCopyId: string | null, today: string): string {
  const copies = editions.flatMap((e) => e.copies);
  const copy = copies.find((c) => c.id === atHandCopyId) ?? heldFirst(copies)[0];
  return copy ? copyWhereabouts(copy, { today }) : "Not owned";
}

/** At hand at the home: an available copy there, or at a digital location */
export function queueAtHand(editions: QueueEdition[], homeId: string | null) {
  return editions.some((e) => e.copies.some((c) => isAtHand(c, homeId)));
}

export type TimeToRead =
  | { kind: "audio"; minutes: number }
  | { kind: "pages"; minutes: number; pages: number; atDefault: boolean }
  | { kind: "none" };

/**
 * One item's time to read: an edition with a known audio length counts as
 * audio (its length); else its pages at his pages an hour for its language
 * and format (his prior). atDefault: no timed session yet, the 30 pages an
 * hour assumed.
 */
export function timeToRead(edition: Pick<QueueEdition, "pageCount" | "audioMinutes" | "language"> | null, format: ReadingFormat, priors: PacePriors): TimeToRead {
  if (edition?.audioMinutes) return { kind: "audio", minutes: edition.audioMinutes };
  if (!edition?.pageCount) return { kind: "none" };
  const prior = priorFor(priors, edition.language, format === "ebook" ? "ebook" : "print");
  return { kind: "pages", pages: edition.pageCount, minutes: (edition.pageCount / prior.value) * 60, atDefault: prior.of === null && prior.value === DEFAULT_PAGES_PER_HOUR };
}

/** "8 h 20 min", "3 h 10 min audio" */
export function timeToReadText(t: TimeToRead): string | null {
  if (t.kind === "none") return null;
  return t.kind === "audio" ? `${hoursWords(t.minutes)} audio` : `About ${hoursWords(t.minutes)}`;
}

/**
 * "14 books · about 96 hours at your pace · 2 without a length"; with no
 * timed session yet, pages only: "14 books · 4,210 pages".
 */
export function queueSummary(times: TimeToRead[]): string {
  const books = `${times.length.toLocaleString("en-US")} ${times.length === 1 ? "book" : "books"}`;
  if (!times.length) return books;
  const without = times.filter((t) => t.kind === "none").length;
  const apart = without ? ` · ${without} without a length` : "";
  const timed = times.filter((t) => t.kind !== "none") as Exclude<TimeToRead, { kind: "none" }>[];
  if (!timed.length) return `${books}${apart}`;
  const atDefault = timed.some((t) => t.kind === "pages" && t.atDefault);
  if (atDefault) {
    const pages = timed.reduce((sum, t) => sum + (t.kind === "pages" ? t.pages : 0), 0);
    const audio = timed.filter((t) => t.kind === "audio");
    const audioText = audio.length ? ` · ${hoursWords(audio.reduce((sum, t) => sum + t.minutes, 0))} of audio` : "";
    return `${books} · ${pages.toLocaleString("en-US")} pages${audioText}${apart}`;
  }
  const minutes = timed.reduce((sum, t) => sum + t.minutes, 0);
  const total = minutes >= 120 ? `about ${Math.round(minutes / 60).toLocaleString("en-US")} hours` : `about ${hoursWords(minutes)}`;
  return `${books} · ${total} at your pace${apart}`;
}

/** "Read in 2012", "Read twice, last in 2019", null when never finished */
export function readHistory(count: number, lastFinishedOn: string | null): string | null {
  if (!count) return null;
  const year = lastFinishedOn?.slice(0, 4);
  if (count === 1) return year ? `Read in ${year}` : "Read once";
  const times = count === 2 ? "twice" : `${count} times`;
  return year ? `Read ${times}, last in ${year}` : `Read ${times}`;
}

/** "1st", "2nd", "3rd", "11th" */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
