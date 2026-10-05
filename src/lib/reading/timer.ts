/*
 * The reading timer's arithmetic (SLN-451). Pure: the chip computes its time
 * in the browser with it, and the service checks a stop with the same rules.
 */

/** A session can be at most 12 hours */
export const MAX_SESSION_SECONDS = 12 * 3600;
export const MAX_SESSION_MESSAGE = "Edit the end time; a session can be at most 12 hours";
export const TIMER_GONE = "This timer was stopped on another device";

export interface TimerClock {
  startedAt: Date | string;
  pausedAt: Date | string | null;
  pausedSeconds: number;
}

const ms = (d: Date | string) => (typeof d === "string" ? new Date(d) : d).getTime();

/** Seconds of reading so far: pauses left out, frozen while paused */
export function elapsedSeconds(t: TimerClock, now: Date = new Date()): number {
  const until = t.pausedAt ? ms(t.pausedAt) : now.getTime();
  return Math.max(0, Math.floor((until - ms(t.startedAt)) / 1000) - t.pausedSeconds);
}

/** "12:04", "1:02:03": minutes and seconds, hours when there are some */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "42 min", "6 h 12 min", "2 h", "under a minute" */
export function durationWords(seconds: number): string {
  const total = Math.floor(seconds / 60);
  if (total < 1) return "under a minute";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "12 minutes", "1 hour 5 minutes": the chip's accessible name */
export function durationSpoken(seconds: number): string {
  const total = Math.floor(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const part = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (!h) return part(m, "minute");
  return m ? `${part(h, "hour")} ${part(m, "minute")}` : part(h, "hour");
}

/** After the check time the chip asks "Still reading?" */
export function shouldAsk(elapsed: number, checkMinutes: number): boolean {
  return elapsed >= checkMinutes * 60;
}

/** Past twice the check time, a timer is never saved without an end time */
export function isForgotten(elapsed: number, checkMinutes: number): boolean {
  return elapsed > 2 * checkMinutes * 60;
}

/** "Stopped at": the start plus the check time plus the time paused so far */
export function suggestedStop(t: TimerClock, checkMinutes: number, now: Date = new Date()): Date {
  const pausedNow = t.pausedAt ? Math.max(0, Math.floor((now.getTime() - ms(t.pausedAt)) / 1000)) : 0;
  return new Date(ms(t.startedAt) + (checkMinutes * 60 + t.pausedSeconds + pausedNow) * 1000);
}

/**
 * Where a stop ends and how long it lasted: at `endedAt` when given, else at
 * the pause, else now. Time paused before the end is left out; a pause still
 * open at an end after it counts as paused up to that end.
 */
export function stopTimes(t: TimerClock, endedAt: Date | null, now: Date = new Date()): { endedAt: Date; pausedSeconds: number; durationSeconds: number } {
  const start = ms(t.startedAt);
  const end = endedAt ?? (t.pausedAt ? new Date(ms(t.pausedAt)) : now);
  let paused = t.pausedSeconds;
  if (t.pausedAt && end.getTime() > ms(t.pausedAt)) paused += Math.floor((end.getTime() - ms(t.pausedAt)) / 1000);
  const durationSeconds = Math.max(1, Math.floor((end.getTime() - start) / 1000) - paused);
  return { endedAt: end, pausedSeconds: Math.min(paused, 86_400), durationSeconds };
}

/** The checks a stop must pass; the message to show, or null */
export function stopProblem(
  t: TimerClock & { title: string },
  endedAt: Date | null,
  checkMinutes: number,
  now: Date = new Date(),
): string | null {
  const start = ms(t.startedAt);
  if (endedAt) {
    if (endedAt.getTime() <= start) return "The end time is before the timer started";
    if (endedAt.getTime() > now.getTime() + 60_000) return "The end time is in the future";
  } else if (isForgotten(elapsedSeconds(t, now), checkMinutes)) {
    return `Your timer for ${t.title} has run ${durationWords(elapsedSeconds(t, now))}. When did you stop?`;
  }
  if (stopTimes(t, endedAt, now).durationSeconds > MAX_SESSION_SECONDS) return MAX_SESSION_MESSAGE;
  return null;
}

/** "21:30": the wall-clock time of an instant in a zone */
export function wallTime(at: Date | string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}

/** "Mexico City" for America/Mexico_City */
export function zoneCity(zone: string): string {
  return (zone.split("/").at(-1) ?? zone).replace(/_/g, " ");
}

/** How far a zone's wall clock is ahead of UTC at an instant, in milliseconds */
function zoneOffset(at: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(at / 1000) * 1000;
}

/**
 * The instant of "21:30" on a reading day in a zone. A time before the day
 * start hour is the next calendar morning: 01:30 on the 4th is the 5th.
 */
export function atWallTime(readOn: string, time: string, zone: string, dayStartHour: number): Date {
  const [h, m] = time.split(":").map(Number);
  const day = new Date(Date.UTC(+readOn.slice(0, 4), +readOn.slice(5, 7) - 1, +readOn.slice(8, 10) + (h < dayStartHour ? 1 : 0), h, m));
  const wall = day.getTime();
  const guess = wall - zoneOffset(wall, zone);
  return new Date(wall - zoneOffset(guess, zone));
}
