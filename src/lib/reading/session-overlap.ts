import { wallTime } from "./timer";

/*
 * Two sessions of one reading never share time. Pure: the session dialog
 * checks it as the time is typed, and addSession and updateSession check it
 * again on save.
 */

export interface TimedSession {
  id: string;
  startedAt: Date | string | null;
  endedAt: Date | string | null;
  durationSeconds: number | null;
  source?: string;
}

/**
 * A session's time: its start to its end, else its start plus its length; a
 * running timer runs until now. Null for a session without a start time, or
 * with no length at all: it takes no time on the clock.
 */
export function sessionSpan(session: Omit<TimedSession, "id">, now = new Date()): { start: number; end: number } | null {
  if (!session.startedAt) return null;
  const start = new Date(session.startedAt).getTime();
  const end = session.endedAt
    ? new Date(session.endedAt).getTime()
    : session.source === "timer"
      ? now.getTime()
      : session.durationSeconds
        ? start + session.durationSeconds * 1000
        : start;
  return end > start ? { start, end } : null;
}

/** The first other session whose time crosses this span; one that ends as the other starts does not */
export function overlappingSession<T extends TimedSession>(
  sessions: T[],
  span: { start: number; end: number } | null,
  exceptId?: string,
  now = new Date(),
): T | null {
  if (!span) return null;
  for (const other of sessions) {
    if (other.id === exceptId) continue;
    const time = sessionSpan(other, now);
    if (time && span.start < time.end && time.start < span.end) return other;
  }
  return null;
}

/**
 * The session an edit would newly share time with. Sessions the edited one
 * already crossed (one saved before this rule) are left out, so it can still
 * take a note or an end without moving.
 */
export function newOverlap<T extends TimedSession>(
  sessions: T[],
  span: { start: number; end: number } | null,
  was: Omit<TimedSession, "id"> | null,
  exceptId?: string,
  now = new Date(),
): T | null {
  const before = was ? sessionSpan(was, now) : null;
  const others = before ? sessions.filter((s) => !overlappingSession([s], before, exceptId, now)) : sessions;
  return overlappingSession(others, span, exceptId, now);
}

/** "Overlaps the session from 14:00 to 14:45" */
export function overlapMessage(other: TimedSession, zone: string, now = new Date()): string {
  const time = sessionSpan(other, now)!;
  return `Overlaps the session from ${wallTime(new Date(time.start), zone)} to ${wallTime(new Date(time.end), zone)}`;
}
