import { NextRequest } from "next/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import { readJson } from "@/lib/api/rest";
import { positionShort, positionWords, progressFromText, requireReadingsToken, spoken, spokenError, zoneOf, type ProgressGiven } from "@/lib/api/readings";
import { CACHE_TAGS, invalidate } from "@/lib/cache";
import { progressEvent, readingEvent } from "@/lib/reading/activity";
import { isOpenStatus } from "@/lib/reading/constants";
import { loadReading, recordProgress } from "@/lib/reading/service";
import { isUuid } from "@/lib/utils/uuid";

const bodySchema = z
  .object({
    text: z.string().trim().min(1).max(100).optional(),
    page: z.number().int().min(0).max(100_000).optional(),
    percent: z.number().min(0).max(100).optional(),
    minutes: z.number().int().min(0).max(1_000_000).optional(),
    durationMinutes: z.number().int().min(1).max(720).optional(),
    note: z.string().trim().max(2000).optional(),
    tz: z.unknown().optional(),
  })
  .refine((b) => [b.text, b.page, b.percent, b.minutes].filter((v) => v !== undefined).length === 1, "Send one of text, page, percent or minutes");

/**
 * POST /api/readings/[id]/progress (SLN-451): logs progress on one reading.
 * `text` takes what a Shortcut dictates ("page 212", "44 percent", "+20").
 * No fingerprint: the service reads the reading fresh, asserts it in the
 * same write and retries once. Reaching the end never finishes the book.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  try {
    const { id } = await params;
    if (!isUuid(id)) return spoken(404, "No such reading in Durtal");
    const parsed = bodySchema.safeParse((await readJson(req)) ?? {});
    if (!parsed.success) return spoken(400, parsed.error.issues[0]?.message ?? "Check what you sent", { issues: parsed.error.issues });
    const body = parsed.data;
    const tz = zoneOf(body.tz);
    if (tz === null) return spoken(400, "The time zone is not one Durtal knows, such as Europe/Amsterdam");
    const reading = await loadReading(id);
    if (!reading) return spoken(404, "No such reading in Durtal");
    const [work] = await db.select({ title: works.title }).from(works).where(eq(works.id, reading.workId));
    const title = work?.title ?? "this book";
    if (!isOpenStatus(reading.status)) return spoken(409, `${title} is ${reading.status}; reopen it in Durtal`, { readingId: id });
    let given: ProgressGiven;
    if (body.text !== undefined) {
      const fromText = progressFromText(body.text, reading);
      if (!fromText.ok) return spoken(400, fromText.error);
      given = fromText.value;
    } else given = { page: body.page, percent: body.percent, minutes: body.minutes };
    const result = await recordProgress(
      { readingId: id, ...given, note: body.note, durationSeconds: body.durationMinutes ? body.durationMinutes * 60 : undefined, timeZone: tz },
      { source: "manual" },
    );
    if (result.resumed) readingEvent(reading.workId, "work.reading_resumed", result.reading);
    await progressEvent(result.reading, result.session.readOn);
    invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
    const where = positionWords(title, result.reading);
    const message = result.reachedEnd
      ? `That is the last page of ${title}. Finish it in Durtal`
      : result.wentBack === "fixed_last_log"
        ? `Corrected your last log of ${title} to ${positionShort(result.reading)}`
        : `Logged ${where}`;
    return spoken(200, message, {
      readingId: id,
      position: { page: result.reading.currentPage, percent: result.reading.currentPercent, minutes: result.reading.currentMinutes },
    });
  } catch (err) {
    return spokenError(err, "Could not log the progress");
  }
}
