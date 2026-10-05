import { isbn10To13, validIsbn10, validIsbn13 } from "@/lib/match/plan";
import { finishAfterStart } from "@/lib/validations/reading";
import { sanitizeCommentHtml } from "@/lib/utils/sanitize";
import type { ImportReading } from "./types";

/*
 * Cell readers shared by the format mappers (SLN-450). The file is untrusted:
 * every string is trimmed and cut to the length its column allows before it
 * is stored, and a review is sanitized.
 */

/** A trimmed cell cut to `max` characters; "" becomes null */
export function text(value: string | undefined, max = 500): string | null {
  const s = (value ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/** A whole number from a cell, or null */
export function int(value: string | undefined, { min = 0, max = 100_000 } = {}): number | null {
  const s = (value ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/**
 * The ISBNs of a cell: Goodreads writes `="0140449132"` and `=""`. Only a
 * valid check digit counts; an ISBN-10 also gives its ISBN-13 for matching.
 */
export function isbns(...cells: (string | undefined)[]): { isbn13: string | null; isbn10: string | null } {
  let isbn13: string | null = null;
  let isbn10: string | null = null;
  for (const cell of cells) {
    const raw = (cell ?? "").replace(/^=/, "").replace(/"/g, "").replace(/[\s-]/g, "");
    if (!raw) continue;
    const thirteen = validIsbn13(raw);
    if (thirteen) isbn13 ??= thirteen;
    const ten = validIsbn10(raw);
    if (ten) {
      isbn10 ??= ten;
      isbn13 ??= isbn10To13(ten);
    }
  }
  return { isbn13, isbn10 };
}

/** A real calendar day "YYYY-MM-DD" from "2019/04/14" or "2019-04-14", else null */
export function day(value: string | undefined): string | null {
  const m = (value ?? "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A review from the file as sanitized HTML, at most 200,000 characters.
 * Goodreads writes `<b>` and `<i>`, which become `<strong>` and `<em>`; plain
 * text (StoryGraph) becomes paragraphs, its single line breaks `<br>`.
 */
export function review(value: string | undefined): string | null {
  const s = (value ?? "").trim().slice(0, 200_000);
  if (!s) return null;
  const html = /<\/?[a-z][^>]*>/i.test(s)
    ? s.replace(/<(\/?)b(\s[^>]*)?>/gi, "<$1strong>").replace(/<(\/?)i(\s[^>]*)?>/gi, "<$1em>")
    : s
        .split(/\r?\n\s*\r?\n/)
        .map((p) => `<p>${escapeHtml(p.trim()).replace(/\r?\n/g, "<br>")}</p>`)
        .join("");
  const clean = sanitizeCommentHtml(html).trim();
  return clean || null;
}

/** A rating rounded to the nearest half star, ties up (3.75 is 4, 3.25 is 3.5); 0 or none is unrated */
export function halfStar(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const r = Math.floor(value * 2 + 0.5) / 2;
  return Math.min(5, Math.max(0.5, r));
}

/** The date rule of the reading tracker: the finish period ends on or after the start */
export function datesError(r: Pick<ImportReading, "startedOn" | "startedPrecision" | "finishedOn" | "finishedPrecision">): string | null {
  return finishAfterStart(r) ? null : "The finish date is before the start date";
}

/** Cells for error messages: never more than 200 characters of what the file says */
export function shown(value: string | null | undefined) {
  const s = (value ?? "").trim();
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}
