import { z } from "zod/v4";
import { durtalImportRowKey, durtalReadingKey } from "../source-keys";
import {
  ABANDON_REASONS,
  READING_DATE_PRECISIONS,
  READING_FORMATS,
  READING_STATUSES,
  READING_UNITS,
  isOpenStatus,
  type ReadingDatePrecision,
} from "../constants";
import { halfStepRatingSchema } from "@/lib/validations/reading";
import { DURTAL_READING_COLUMNS } from "./durtal-format";
import { datesError, day, isbns, review, shown, text } from "./fields";
import type { ImportReading, ImportRow, ParsedFile } from "./types";

/*
 * A Durtal reading CSV (SLN-450): the seed step's output, and the export of a
 * later step. One row is one reading. Every value is checked against the
 * tracker's constants; a row that breaks a rule cannot be imported, with the
 * reason. `start_page` is checked but not written: an imported reading starts
 * where its position is, as `writeReadings` writes it. Columns after
 * `source_key`, and unknown ones, are ignored.
 */

const uuid = z.uuid();
const isUuid = (s: string) => uuid.safeParse(s).success;

/** A whole number cell within its limits; "" is null, anything else an error */
function count(value: string, label: string, min: number, max: number, errors: string[]): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    errors.push(`${label} "${shown(value)}" is not a whole number from ${min} to ${max}`);
    return null;
  }
  return Number(value);
}

/** A value of one of the tracker's lists; "" gives `empty` */
function oneOf<T extends string>(value: string, list: readonly T[], label: string, empty: T | null, errors: string[]): T | null {
  if (!value) return empty;
  if ((list as readonly string[]).includes(value)) return value as T;
  errors.push(`${label} "${shown(value)}" is not one of ${list.join(", ")}`);
  return empty;
}

/** A date and its precision: an empty date is unknown; a date with no precision is a day */
function dated(dateCell: string, precisionCell: string, label: string, errors: string[]): { on: string | null; precision: ReadingDatePrecision } {
  const precision = oneOf(precisionCell, READING_DATE_PRECISIONS, `${label} precision`, null, errors);
  if (!dateCell) return { on: null, precision: "unknown" };
  const on = day(dateCell);
  if (!on) {
    errors.push(`${label} "${shown(dateCell)}" is not a date such as 2019-04-14`);
    return { on: null, precision: "unknown" };
  }
  if (precision === "unknown") {
    errors.push(`${label} has a date, so its precision cannot be unknown`);
    return { on: null, precision: "unknown" };
  }
  return { on, precision: precision ?? "day" };
}

export function mapDurtal(headers: string[], records: Record<string, string>[]): ParsedFile {
  const missing = DURTAL_READING_COLUMNS.filter((c) => !headers.includes(c)).map(
    (c) => `This file has no ${c} column; it is read as empty`,
  );
  const rows = records.map((record): ImportRow => {
    const cell = (c: (typeof DURTAL_READING_COLUMNS)[number]) => (record[c] ?? "").trim();
    const errors: string[] = [];
    const warnings: string[] = [];
    const title = text(cell("title"), 500) ?? "";
    const authors = cell("authors").split(";").map((a) => a.trim()).filter(Boolean).slice(0, 20).map((a) => a.slice(0, 300));
    const { isbn13, isbn10 } = isbns(cell("isbn13"));

    // The ids: a malformed book id is an error; a malformed edition or copy id is dropped
    const id = (c: "reading_id" | "work_id" | "edition_id" | "instance_id", required: boolean) => {
      const v = cell(c).toLowerCase();
      if (!v) return null;
      if (isUuid(v)) return v;
      if (required) errors.push(`${c} "${shown(v)}" is not a Durtal id`);
      else warnings.push(`${c} "${shown(v)}" is not a Durtal id; it is left out`);
      return null;
    };
    const readingId = id("reading_id", true);
    const workId = id("work_id", true);
    const editionId = id("edition_id", false);
    const instanceId = editionId ? id("instance_id", false) : null;

    const status = oneOf(cell("status"), READING_STATUSES, "status", null, errors);
    if (!cell("status")) errors.push("The row has no status");
    const format = oneOf(cell("format"), READING_FORMATS, "format", "print", errors) ?? "print";
    const unit = oneOf(cell("unit"), READING_UNITS, "unit", format === "audio" ? "minutes" : "pages", errors) ?? "pages";
    const totalPages = count(cell("total_pages"), "total_pages", 1, 100_000, errors);
    const totalMinutes = count(cell("total_minutes"), "total_minutes", 1, 1_000_000, errors);
    const startPage = count(cell("start_page"), "start_page", 0, 100_000, errors);
    const page = count(cell("current_page"), "current_page", 0, 100_000, errors);
    const minutes = count(cell("current_minutes"), "current_minutes", 0, 1_000_000, errors);
    const percentCell = cell("current_percent");
    const percent = percentCell === "" ? null : Number(percentCell);
    if (percent !== null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) errors.push(`current_percent "${shown(percentCell)}" is not from 0 to 100`);
    const chapter = text(cell("current_chapter"), 300);
    if (totalPages !== null && startPage !== null && startPage > totalPages) errors.push(`start_page ${startPage} is past the last page, ${totalPages}`);
    if (totalPages !== null && page !== null && page > totalPages) errors.push(`current_page ${page} is past the last page, ${totalPages}`);
    if (totalMinutes !== null && minutes !== null && minutes > totalMinutes) errors.push(`current_minutes ${minutes} is past the end, ${totalMinutes}`);

    const started = dated(cell("started_on"), cell("started_precision"), "started_on", errors);
    const finished = dated(cell("finished_on"), cell("finished_precision"), "finished_on", errors);
    if (status && isOpenStatus(status) && finished.on) errors.push("An open reading has no finish date");

    const ratingCell = cell("rating");
    let rating: number | null = null;
    if (ratingCell) {
      const parsed = halfStepRatingSchema.safeParse(Number(ratingCell));
      if (parsed.success) rating = parsed.data;
      else errors.push(`rating "${shown(ratingCell)}" is not from 0.5 to 5 in half steps`);
    }
    const abandonReason = oneOf(cell("abandon_reason"), ABANDON_REASONS, "abandon_reason", null, errors);
    const abandonNote = text(cell("abandon_note"), 2000);
    if (status !== "abandoned" && (abandonReason || abandonNote)) errors.push("Only an abandoned read has a reason");

    // The key: the stored one, else the reading's, else the row's own cells
    const sourceKey =
      cell("source_key").slice(0, 500) ||
      (readingId ? durtalReadingKey(readingId) : durtalImportRowKey(DURTAL_READING_COLUMNS.map((c) => record[c])));
    const hasPosition = [page, percent, minutes, chapter].some((v) => v !== null);
    const reading: ImportReading = {
      n: 1,
      status: status ?? "finished",
      startedOn: started.on,
      startedPrecision: started.precision,
      finishedOn: status && isOpenStatus(status) ? null : finished.on,
      finishedPrecision: status && isOpenStatus(status) ? "unknown" : finished.precision,
      format,
      unit,
      totalPages,
      totalMinutes,
      // A finished read is at its end; the others are where the file says
      position: status !== "finished" && hasPosition ? { page, percent, minutes, chapter } : null,
      rating,
      reviewHtml: review(cell("review_html")),
      abandonReason: status === "abandoned" ? abandonReason : null,
      abandonNote: status === "abandoned" ? abandonNote : null,
      readingId,
      sourceKey,
    };
    const datesProblem = datesError(reading);
    if (datesProblem) errors.push(datesProblem);
    if (!title && !workId) errors.push("The row has neither a title nor a work_id");
    return {
      kind: "readings",
      sourceBookId: null,
      title,
      authors,
      isbn13,
      isbn10,
      fileRating: rating,
      rating,
      reviewHtml: reading.reviewHtml,
      shelves: [],
      privateNotes: null,
      pages: totalPages,
      extras: {},
      workId,
      editionId,
      instanceId,
      readings: [reading],
      warnings,
      error: errors[0] ?? null,
    };
  });
  return { source: "durtal", rows, missing };
}
