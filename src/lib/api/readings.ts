import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { requireApiToken } from "@/lib/api/rest";
import { isTimeZone } from "@/lib/reading/dates";
import { parseProgressInput } from "@/lib/reading/positions";
import { MAX_SESSION_MESSAGE, TIMER_GONE } from "@/lib/reading/timer";
import { formatMinutes } from "@/lib/reading/positions";

/*
 * The phone's routes, /api/readings (SLN-451). An Authelia rule lets these
 * paths through without a session (docs/11), so every one of them, GETs
 * included, checks the token first. Every answer is short JSON with a
 * `message` a Shortcut can speak.
 */

/** An answer with a message a Shortcut can speak */
export function spoken(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ message, ...extra }, { status });
}

/** The token check, with a spoken message */
export function requireReadingsToken(req: NextRequest): NextResponse | null {
  const refused = requireApiToken(req);
  if (!refused) return null;
  return spoken(refused.status, refused.status === 503 ? "Durtal has no API token set" : "Durtal refused the token", { error: refused.status === 503 ? "Writes are disabled: DURTAL_API_TOKEN is not set" : "Unauthorized" });
}

/** An optional IANA zone: undefined when absent, null when invalid */
export function zoneOf(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" && isTimeZone(value) ? value : null;
}

export interface OpenReading {
  id: string;
  workId: string;
  title: string;
  author: string | null;
  status: "reading" | "paused";
  unit: "pages" | "percent" | "minutes";
  totalPages: number | null;
  totalMinutes: number | null;
  position: { page: number | null; percent: number | null; minutes: number | null };
}

/** The open readings, most recently read first */
export async function openReadings(): Promise<OpenReading[]> {
  return resultRows<OpenReading>(
    await db.execute(sql`
      select r.id::text as id, w.id::text as "workId", w.title,
        (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id order by wa.sort_order, a.name limit 1) as author,
        r.status, r.unit, r.total_pages as "totalPages", r.total_minutes as "totalMinutes",
        jsonb_build_object('page', r.current_page, 'percent', r.current_percent::float8, 'minutes', r.current_minutes) as position
      from readings r join works w on w.id = r.work_id
      where r.status in ('reading', 'paused') and w.kind = 'book'
      order by r.last_read_at desc nulls last, r.updated_at desc`),
  );
}

/** "Nadja and La Curée", "Nadja, Watt and La Curée" */
export function titles(list: string[]) {
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

export type ProgressGiven = { page?: number; percent?: number; minutes?: number; addPages?: number; addMinutes?: number; chapter?: string };

/** A dictated or typed position: "page 212", "44 percent", "+20", "3:12"; the reading's unit for a bare number */
export function progressFromText(
  text: string,
  reading: { unit: "pages" | "percent" | "minutes"; totalPages: number | null; totalMinutes: number | null },
): { ok: true; value: ProgressGiven } | { ok: false; error: string } {
  // Dictation writes words: "44 percent", "page two hundred" is left to the parser's hint
  const said = text.trim().replace(/\s*per\s?cent$/i, "%").replace(/^plus\s*/i, "+");
  const parsed = parseProgressInput(said, reading);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  switch (v.kind) {
    case "page":
      return { ok: true, value: { page: v.page } };
    case "percent":
      return { ok: true, value: { percent: v.percent } };
    case "minutes":
      return { ok: true, value: { minutes: v.minutes } };
    case "addPages":
      return { ok: true, value: { addPages: v.pages } };
    case "addMinutes":
      return { ok: true, value: { addMinutes: v.minutes } };
    case "chapter":
      return { ok: true, value: { chapter: v.chapter } };
  }
}

/** "page 212", "44%", "3:12" */
export function positionShort(r: { unit: string; currentPage: number | null; currentPercent: number | null; currentMinutes: number | null }) {
  if (r.unit === "minutes" && r.currentMinutes != null) return formatMinutes(r.currentMinutes);
  if (r.unit === "pages" && r.currentPage != null) return `page ${r.currentPage}`;
  return r.currentPercent != null ? `${Math.round(r.currentPercent)}%` : "the start";
}

/** "page 212 of Nadja, 44%", "44% of Nadja", "3:12 of Nadja, 44%" */
export function positionWords(title: string, r: { unit: string; currentPage: number | null; currentPercent: number | null; currentMinutes: number | null }) {
  const pct = r.currentPercent != null ? `${Math.round(r.currentPercent)}%` : null;
  if (r.unit === "minutes" && r.currentMinutes != null) return `${formatMinutes(r.currentMinutes)} of ${title}${pct ? `, ${pct}` : ""}`;
  if (r.unit === "pages" && r.currentPage != null) return `page ${r.currentPage} of ${title}${pct ? `, ${pct}` : ""}`;
  return `${pct ?? "your place"} of ${title}`;
}

/** A thrown error as a spoken answer, with the status that fits it */
export function spokenError(err: unknown, fallback: string): NextResponse {
  if (err instanceof z.ZodError) return spoken(400, err.issues[0]?.message ?? "Check what you sent", { issues: err.issues });
  const message = err instanceof Error ? err.message : fallback;
  if (message === TIMER_GONE) return spoken(404, "No timer is running");
  if (message === "This reading changed elsewhere; try again") return spoken(409, message);
  if (message.startsWith("A timer is running for")) return spoken(409, message);
  if (message === MAX_SESSION_MESSAGE) return spoken(400, message);
  if (message.startsWith("Your timer for")) return spoken(409, message.replace("When did you stop?", "Say when you stopped, or stop it in Durtal"));
  if (/^(Page \d+ is past|.* is past the end|The end time|Give one position|Enter )/.test(message)) return spoken(400, message);
  if (message === "This reading no longer exists") return spoken(404, message);
  console.error(`[api/readings] ${fallback}:`, err);
  return spoken(500, fallback);
}
