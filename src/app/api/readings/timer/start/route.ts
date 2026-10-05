import { NextRequest } from "next/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import { readJson } from "@/lib/api/rest";
import { openReadings, requireReadingsToken, spoken, spokenError, titles, zoneOf } from "@/lib/api/readings";
import { CACHE_TAGS, invalidate } from "@/lib/cache";
import { readingEvent } from "@/lib/reading/activity";
import { loadReading } from "@/lib/reading/service";
import { startTimerOn } from "@/lib/reading/timer-service";

const bodySchema = z.object({ readingId: z.uuid().optional(), tz: z.unknown().optional() });

/**
 * POST /api/readings/timer/start (SLN-451): starts the timer on a reading,
 * or on the one open reading when none is named.
 */
export async function POST(req: NextRequest) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  try {
    const parsed = bodySchema.safeParse((await readJson(req)) ?? {});
    if (!parsed.success) return spoken(400, "Send a reading id, or nothing for the one open reading", { issues: parsed.error.issues });
    const tz = zoneOf(parsed.data.tz);
    if (tz === null) return spoken(400, "The time zone is not one Durtal knows, such as Europe/Amsterdam");
    let readingId = parsed.data.readingId;
    if (!readingId) {
      const open = await openReadings();
      if (!open.length) return spoken(404, "No book is being read");
      if (open.length > 1) return spoken(400, `Several books are open: ${titles(open.map((r) => r.title))}. Say which one`, { readings: open.map((r) => ({ id: r.id, title: r.title })) });
      readingId = open[0].id;
    }
    const reading = await loadReading(readingId);
    if (!reading) return spoken(404, "No such reading in Durtal");
    const [work] = await db.select({ title: works.title }).from(works).where(eq(works.id, reading.workId));
    if (reading.status !== "reading" && reading.status !== "paused") return spoken(409, `${work?.title ?? "This book"} is ${reading.status}; reopen it in Durtal`);
    const result = await startTimerOn(readingId, tz);
    if (result.resumed) readingEvent(reading.workId, "work.reading_resumed", result.reading);
    invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
    return spoken(200, `Timer started for ${work?.title ?? "your book"}`, { readingId, sessionId: result.sessionId });
  } catch (err) {
    return spokenError(err, "Could not start the timer");
  }
}
