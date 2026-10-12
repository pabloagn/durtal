import type { RunningTimer } from "./timer-service";
import { isForgotten } from "./timer";

export const STILL_READING_KEY = "durtal-timer-still-reading";
export function needsTimerCheck(timer: RunningTimer, elapsed: number, checkMinutes: number): boolean {
  if (timer.pausedAt || !isForgotten(elapsed, checkMinutes)) return false;
  try {
    const still: unknown = JSON.parse(localStorage.getItem(STILL_READING_KEY) ?? "null");
    if (still && typeof still === "object" && "sessionId" in still && still.sessionId === timer.sessionId && "until" in still && typeof still.until === "number" && elapsed < still.until) return false;
  } catch { /* An unavailable store does not hide a forgotten timer. */ }
  return true;
}
export function acknowledgeTimerCheck(timer: RunningTimer, elapsed: number, checkMinutes: number) {
  try { localStorage.setItem(STILL_READING_KEY, JSON.stringify({ sessionId: timer.sessionId, until: elapsed + checkMinutes * 60 })); } catch { /* Same behavior as the timer dialog. */ }
}
