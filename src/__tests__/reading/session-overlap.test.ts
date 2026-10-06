import { describe, expect, it } from "vitest";
import { newOverlap, overlapMessage, overlappingSession, sessionSpan } from "@/lib/reading/session-overlap";

/* Two sessions of one reading never share time */

const at = (hhmm: string) => new Date(`2026-09-15T${hhmm}:00Z`);
const session = (id: string, start: string | null, end: string | null, durationSeconds: number | null = null, source = "manual") => ({
  id,
  startedAt: start ? at(start) : null,
  endedAt: end ? at(end) : null,
  durationSeconds,
  source,
});

describe("session overlap", () => {
  const sessions = [session("a", "12:00", "12:45"), session("b", "15:00", null, 1800), session("c", null, null, 3600)];

  it("finds a session whose time crosses the span", () => {
    expect(overlappingSession(sessions, sessionSpan(session("n", "12:30", null, 1800)))?.id).toBe("a");
    expect(overlappingSession(sessions, sessionSpan(session("n", "11:00", "13:00")))?.id).toBe("a");
    expect(overlappingSession(sessions, sessionSpan(session("n", "15:20", "15:40")))?.id).toBe("b");
  });

  it("lets one start as the other ends, and ignores sessions without a start", () => {
    expect(overlappingSession(sessions, sessionSpan(session("n", "12:45", "13:00")))).toBeNull();
    expect(overlappingSession(sessions, sessionSpan(session("n", "11:00", "12:00")))).toBeNull();
    expect(sessionSpan(session("n", null, null, 600))).toBeNull();
    expect(sessionSpan(session("n", "10:00", null))).toBeNull();
  });

  it("leaves out the session being edited, and runs a timer to now", () => {
    expect(overlappingSession(sessions, sessionSpan(session("a", "12:10", "12:50")), "a")).toBeNull();
    const timer = session("t", "16:00", null, null, "timer");
    expect(overlappingSession([timer], sessionSpan(session("n", "16:30", "16:40")), undefined, at("17:00"))?.id).toBe("t");
    expect(overlappingSession([timer], sessionSpan(session("n", "16:30", "16:40")), undefined, at("16:20"))).toBeNull();
  });

  it("lets an edit keep time it already shared, and refuses new time", () => {
    // Saved before the rule: d already crosses a
    const d = session("d", "12:30", "13:00");
    const all = [...sessions, d];
    expect(newOverlap(all, sessionSpan(d), d, "d")).toBeNull();
    expect(newOverlap(all, sessionSpan(session("d", "12:35", "13:05")), d, "d")).toBeNull();
    expect(newOverlap(all, sessionSpan(session("d", "14:50", "15:10")), d, "d")?.id).toBe("b");
    expect(newOverlap(sessions, sessionSpan(d), null)?.id).toBe("a");
  });

  it("names the other session's times in the reader's zone", () => {
    expect(overlapMessage(sessions[0], "Europe/Amsterdam")).toBe("Overlaps the session from 14:00 to 14:45");
    expect(overlapMessage(sessions[1], "UTC")).toBe("Overlaps the session from 15:00 to 15:30");
  });
});
