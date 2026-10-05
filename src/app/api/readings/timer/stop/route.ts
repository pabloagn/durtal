import { NextRequest } from "next/server";
import { z } from "zod/v4";
import { readJson } from "@/lib/api/rest";
import { positionWords, progressFromText, requireReadingsToken, spoken, spokenError, type ProgressGiven } from "@/lib/api/readings";
import { CACHE_TAGS, invalidate } from "@/lib/cache";
import { progressEvent, readingEvent } from "@/lib/reading/activity";
import { recordProgress } from "@/lib/reading/service";
import { runningTimer } from "@/lib/reading/timer-service";
import { durationWords, elapsedSeconds, isForgotten } from "@/lib/reading/timer";
import { getAppSettings } from "@/lib/actions/settings";

const bodySchema = z.object({ text: z.string().trim().min(1).max(100).optional(), endedAt: z.iso.datetime({ offset: true }).optional() });

/**
 * POST /api/readings/timer/stop (SLN-451): stops the running timer, at
 * `endedAt` (ISO 8601) or now, where `text` says ("page 212"), or where it
 * started. A forgotten timer needs `endedAt`. The timer keeps the zone and
 * the day it started with, so this route takes no `tz`.
 */
export async function POST(req: NextRequest) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  try {
    const parsed = bodySchema.safeParse((await readJson(req)) ?? {});
    if (!parsed.success) return spoken(400, "Send text such as page 212, and endedAt as an ISO time", { issues: parsed.error.issues });
    const timer = await runningTimer();
    if (!timer) return spoken(404, "No timer is running");
    const endedAt = parsed.data.endedAt ? new Date(parsed.data.endedAt) : undefined;
    const { readingTimerCheckMinutes } = await getAppSettings();
    if (!endedAt && isForgotten(elapsedSeconds(timer), readingTimerCheckMinutes))
      return spoken(409, `Your timer for ${timer.title} has run ${durationWords(elapsedSeconds(timer))}. Say when you stopped, or stop it in Durtal`, {
        readingId: timer.readingId,
      });
    let given: ProgressGiven = {};
    if (parsed.data.text) {
      const fromText = progressFromText(parsed.data.text, timer);
      if (!fromText.ok) return spoken(400, fromText.error);
      given = fromText.value;
    }
    const result = await recordProgress({ readingId: timer.readingId, ...given, endedAt, timerSessionId: timer.sessionId }, { source: "timer" });
    if (result.resumed) readingEvent(timer.workId, "work.reading_resumed", result.reading);
    await progressEvent(result.reading, result.session.readOn);
    invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
    const time = durationWords(result.session.durationSeconds ?? 0);
    const message = result.reachedEnd
      ? `Stopped the timer: ${time}. That is the last page of ${timer.title}. Finish it in Durtal`
      : `Stopped the timer: ${time}, ${positionWords(timer.title, result.reading)}`;
    return spoken(200, message, {
      readingId: timer.readingId,
      durationSeconds: result.session.durationSeconds,
      position: { page: result.reading.currentPage, percent: result.reading.currentPercent, minutes: result.reading.currentMinutes },
    });
  } catch (err) {
    return spokenError(err, "Could not stop the timer");
  }
}
