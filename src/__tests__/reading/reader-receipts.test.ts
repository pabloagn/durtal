import { describe, expect, it } from "vitest";
import { parseReaderSession, parseReaderSessionJson } from "@/lib/validations/reader-tracking";
import { canMergeReaderSitting, decideSittingReceipt, retireSittingReceipt, type SittingReceipt, type ReaderMergeCandidate } from "@/lib/reading/reader-receipts";

const owner = { ebookId: "00000000-0000-4000-a000-000000000001", deviceId: "00000000-0000-4000-a000-000000000002" };
const payload = {
  sittingId: "00000000-0000-4000-a000-000000000003", readingId: "00000000-0000-4000-a000-000000000004",
  revision: 1, startedAt: "2026-10-09T12:00:00Z", endedAt: "2026-10-09T12:05:00Z",
  activeSeconds: 300, startPercent: 10, endPercent: 20,
};
const now = new Date("2026-10-09T13:00:00Z");
const snapshot = parseReaderSession(payload, now, "Europe/Amsterdam");
const receipt: SittingReceipt = { ...snapshot, ...owner, originalSessionId: payload.sittingId, sessionId: payload.sittingId, retired: false, goingBack: false };

describe("reader session transport", () => {
  it("defaults the zone, cuts chapters, and refuses a client-controlled source", () => {
    expect(snapshot.timeZone).toBe("Europe/Amsterdam");
    expect(parseReaderSession({ ...payload, endChapter: "a".repeat(450) }, now, "Europe/Amsterdam").endChapter).toHaveLength(300);
    expect(() => parseReaderSession({ ...payload, source: "manual" }, now, "Europe/Amsterdam")).toThrow();
  });
  it.each([
    { sittingId: undefined }, { readingId: undefined }, { revision: 0 }, { revision: 1.5 },
    { startPercent: -1 }, { endPercent: 101 }, { endPercent: NaN }, { activeSeconds: 0 },
    { activeSeconds: 86_401 }, { activeSeconds: 301 }, { timeZone: "Not/AZone" },
    { endedAt: "2026-10-09T11:59:00Z" }, { endedAt: 123 }, { endChapter: "x".repeat(2049) },
  ])("refuses malformed snapshots: %j", (patch) => {
    expect(() => parseReaderSession({ ...payload, ...patch }, now, "Europe/Amsterdam")).toThrow();
  });
  it("bounds future clocks and rejects an invalid default zone", () => {
    expect(() => parseReaderSession(payload, new Date("2026-10-09T12:03:59Z"), "Europe/Amsterdam")).toThrow("future");
    expect(() => parseReaderSession(payload, now, "Not/AZone")).toThrow();
  });
  it("bounds JSON bytes before parsing and normalizes database percentage precision", () => {
    expect(parseReaderSessionJson(JSON.stringify(payload), now, "Europe/Amsterdam").readingId).toBe(payload.readingId);
    expect(() => parseReaderSessionJson("𐐀".repeat(2049), now, "Europe/Amsterdam")).toThrow("request limit");
    expect(() => parseReaderSessionJson("{", now, "Europe/Amsterdam")).toThrow();
    expect(parseReaderSession({ ...payload, startPercent: 10.1234 }, now, "Europe/Amsterdam").startPercent).toBe(10.12);
  });
});

describe("durable sitting receipt policy", () => {
  it("inserts once, ignores replays, and adds only the cumulative increase", () => {
    expect(decideSittingReceipt(null, snapshot, owner)).toEqual({ kind: "insert", addedSeconds: 300 });
    expect(decideSittingReceipt(receipt, snapshot, owner)).toEqual({ kind: "ignore", reason: "replayed" });
    const later = parseReaderSession({ ...payload, revision: 2, endedAt: "2026-10-09T12:06:00Z", activeSeconds: 330, endPercent: 21 }, now, "Europe/Amsterdam");
    expect(decideSittingReceipt(receipt, later, owner)).toEqual({ kind: "update", addedSeconds: 30 });
    expect(decideSittingReceipt({ ...receipt, revision: 2 }, snapshot, owner)).toEqual({ kind: "ignore", reason: "replayed" });
  });
  it("allows a new position revision without adding time", () => {
    expect(decideSittingReceipt(receipt, { ...snapshot, revision: 2, endPercent: 22 }, owner)).toEqual({ kind: "update", addedSeconds: 0 });
  });
  it("refuses reuse of a revision with different data and regressing cumulative time", () => {
    expect(decideSittingReceipt(receipt, { ...snapshot, endPercent: 22 }, owner)).toEqual({ kind: "refuse", reason: "revision_reused" });
    expect(decideSittingReceipt(receipt, { ...snapshot, revision: 2, activeSeconds: 200 }, owner)).toEqual({ kind: "refuse", reason: "clock_regressed" });
    expect(decideSittingReceipt(receipt, { ...snapshot, revision: 2, endedAt: new Date("2026-10-09T12:04:00Z") }, owner).kind).toBe("refuse");
  });
  it("keeps deletion/edit retirement permanent even if a later flush has more time", () => {
    const retired = retireSittingReceipt(receipt);
    expect(retired.sittingId).toBe(receipt.sittingId);
    expect(retired.readingId).toBe(receipt.readingId);
    expect(retired.originalSessionId).toBe(receipt.originalSessionId);
    expect(decideSittingReceipt(retired, { ...snapshot, revision: 999, activeSeconds: 400 }, owner)).toEqual({ kind: "ignore", reason: "retired" });
    expect(decideSittingReceipt({ ...receipt, sessionId: null }, snapshot, owner)).toEqual({ kind: "ignore", reason: "retired" });
    // Explicit restore/compensation cannot reopen acceptance of old queued flushes.
    expect(decideSittingReceipt({ ...retired, sessionId: receipt.sessionId }, snapshot, owner)).toEqual({ kind: "ignore", reason: "retired" });
  });
  it("refuses a delayed beacon bound to a different reading, ebook, device or start", () => {
    for (const input of [
      { ...snapshot, readingId: owner.ebookId }, { ...snapshot, startedAt: now },
      { ...snapshot, startPercent: 11 }, { ...snapshot, timeZone: "UTC" },
      { ...snapshot, goingBack: "went_back" as const },
    ]) expect(decideSittingReceipt(receipt, input, owner)).toEqual({ kind: "refuse", reason: "identity_changed" });
    expect(decideSittingReceipt(receipt, snapshot, { ...owner, deviceId: "other" }).kind).toBe("refuse");
    expect(decideSittingReceipt(receipt, snapshot, { ...owner, ebookId: "other" }).kind).toBe("refuse");
  });

  const previous: ReaderMergeCandidate = {
    readingId: payload.readingId, sessionId: owner.ebookId, source: "reader", endedAt: new Date("2026-10-09T11:55:00Z"),
    format: "ebook", editionId: null, durationSeconds: 100, retired: false, edited: false,
  };
  it("merges within ten minutes, including reloads, but not at or beyond the boundary", () => {
    expect(canMergeReaderSitting(previous, snapshot, null)).toBe(true);
    expect(canMergeReaderSitting({ ...previous, endedAt: new Date("2026-10-09T11:50:00Z") }, snapshot, null)).toBe(false);
    expect(canMergeReaderSitting({ ...previous, endedAt: new Date("2026-10-09T11:45:00Z") }, snapshot, null)).toBe(false);
  });
  it.each([
    { source: "manual" }, { source: "timer" }, { edited: true }, { retired: true },
    { readingId: owner.ebookId }, { format: "print" }, { editionId: owner.ebookId },
    { endedAt: new Date("2026-10-09T12:01:00Z") }, { durationSeconds: 86_200 },
  ])("does not merge protected or overlapping sessions: %j", (patch) => {
    expect(canMergeReaderSitting({ ...previous, ...patch }, snapshot, null)).toBe(false);
  });
  it("starts a fresh session for a counted move back", () => {
    expect(canMergeReaderSitting(previous, { ...snapshot, goingBack: "went_back" }, null)).toBe(false);
  });
});
