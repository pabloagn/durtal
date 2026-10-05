import { NextRequest, NextResponse } from "next/server";
import { openReadings, requireReadingsToken, spoken, spokenError, titles } from "@/lib/api/readings";
import { runningTimer } from "@/lib/reading/timer-service";
import { durationWords, elapsedSeconds } from "@/lib/reading/timer";

/**
 * GET /api/readings/open (SLN-451): the open readings with their position,
 * unit and totals, and the running timer. The token is checked on this GET
 * too: an Authelia rule lets /api/readings through without a session.
 */
export async function GET(req: NextRequest) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  try {
    const [readings, timer] = await Promise.all([openReadings(), runningTimer()]);
    const running = timer
      ? {
          sessionId: timer.sessionId,
          readingId: timer.readingId,
          title: timer.title,
          startedAt: timer.startedAt,
          pausedAt: timer.pausedAt,
          elapsedSeconds: elapsedSeconds(timer),
        }
      : null;
    const message = readings.length
      ? `You are reading ${titles(readings.map((r) => r.title))}${running ? `. The timer has run ${durationWords(running.elapsedSeconds)} for ${running.title}` : ""}`
      : "No book is being read";
    return NextResponse.json({ message, readings, timer: running });
  } catch (err) {
    return spokenError(err, "Could not list the open readings");
  }
}

