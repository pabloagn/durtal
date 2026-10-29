"use client";

import { useSyncExternalStore } from "react";
import { toast } from "@/lib/notifications/toast";
import { readingDay } from "@/lib/reading/dates";
import type { ReadingDetailRow } from "@/lib/reading/overview";
import type { BookReadingSummary, ReadingStartDefaults } from "@/lib/reading/overview-types";
import type { EditionOption, HomeOption } from "@/lib/reading/page-data";
import type { ReadingEstimate } from "@/lib/reading/pace";
import { refusalMessage } from "@/lib/actions/refusal";

/*
 * What the book page's reading pieces share in the browser (SLN-447): the
 * browser's zone and reading day, the pointer type, and the page's data.
 */

export type ReadingRow = ReadingDetailRow;

export interface ReadingPageData {
  workId: string;
  workTitle: string;
  /** The year the work was first published, to flag a past read dated before it (SLN-932) */
  workYear?: number | null;
  bookRating: number | null;
  /** The hour a reading day starts (4: 01:30 counts for the evening before) */
  dayStartHour: number;
  /** Bounded display rows plus, for a dialog, its explicitly requested row. */
  rows: ReadingRow[];
  summary: BookReadingSummary;
  defaults: ReadingStartDefaults;
  history: { closedCount: number; hasMore: boolean };
  editions: EditionOption[];
  homes: HomeOption[];
  /** Today's reading day on the server, for lines on the page only */
  today: string;
  /** The server's zone, so page lines match between server and browser */
  zone: string;
  /** The open reading's time left and finish date, by reading id (SLN-451); the book page only */
  estimates?: Record<string, ReadingEstimate>;
  /** The book's place in Up next, null when not queued (SLN-452); the book page only */
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
  const message = refusalMessage(err, "Could not save");
  toast.error(message);
  if (message.startsWith(STALE)) refresh();
}

/** Undo stays reachable for ten seconds, paused while the toaster has focus. */
export function undoToast(message: string, undo: () => Promise<void | boolean> | void | boolean, restored: string | null = "Undone") {
  toast.success(message, { duration: 10000, action: { label: "Undo", onClick: async () => {
    try {
      const result = await undo();
      if (result !== false && restored) toast.success(restored);
    } catch (error) { toast.error(refusalMessage(error, "Could not undo")); }
  } } });
}
