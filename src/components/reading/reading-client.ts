"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { readingDay } from "@/lib/reading/dates";
import type { getReadingsForWork } from "@/lib/actions/reading";
import type { EditionOption, HomeOption } from "@/lib/reading/page-data";
import type { ReadingEstimate } from "@/lib/reading/pace";

/*
 * What the book page's reading pieces share in the browser (SLN-447): the
 * browser's zone and reading day, the pointer type, and the page's data.
 */

export type ReadingRow = Awaited<ReturnType<typeof getReadingsForWork>>[number];

export interface ReadingPageData {
  workId: string;
  workTitle: string;
  bookRating: number | null;
  /** The hour a reading day starts (4: 01:30 counts for the evening before) */
  dayStartHour: number;
  rows: ReadingRow[];
  editions: EditionOption[];
  homes: HomeOption[];
  /** Today's reading day on the server, for lines on the page only */
  today: string;
  /** The server's zone, so page lines match between server and browser */
  zone: string;
  /** The open reading's time left and finish date, by reading id (SLN-451); the book page only */
  estimates?: Record<string, ReadingEstimate>;
  /** The book's place in Up Next, null when not queued (SLN-452); the book page only */
  queuePlace?: number | null;
}

/** The browser's time zone, sent with every write */
export function browserZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Today's reading day in the browser's zone; computed when a dialog opens */
export function todayReadingDay(dayStartHour: number) {
  return readingDay(new Date(), browserZone(), dayStartHour);
}

const noChange = () => () => {};

/**
 * The browser's reading day, null on the server and while hydrating: goals
 * and the rhythm draw with the server's day first, then this one (SLN-455)
 */
export function useBrowserReadingDay(dayStartHour: number): string | null {
  return useSyncExternalStore(
    noChange,
    () => readingDay(new Date(), browserZone(), dayStartHour),
    () => null,
  );
}

function subscribeCoarse(onChange: () => void) {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on a touch screen: dialogs show keypad-friendly fields */
export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

export const STALE = "This reading changed elsewhere";

/** A failed write: the server's words in a toast; a stale reading refreshes the page */
export function showError(err: unknown, refresh: () => void) {
  const message = err instanceof Error ? err.message : "Could not save";
  toast.error(message);
  if (message.startsWith(STALE)) refresh();
}

/** A 10-second toast with Undo */
export function undoToast(message: string, undo: () => Promise<void> | void) {
  toast.success(message, { duration: 10000, action: { label: "Undo", onClick: () => void undo() } });
}
