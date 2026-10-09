import { describe, expect, it } from "vitest";
import {
  correctLastLog,
  recomputeQueries,
  planPositions,
  sessionOrder,
  type Reading,
  type Session,
} from "@/lib/reading/service";
import { positionInUnit } from "@/lib/reading/positions";
import { updateReadingSchema } from "@/lib/validations/reading";

const reading = {
  editionId: "edition",
  unit: "pages",
  format: "print",
  status: "reading",
  totalPages: 600,
  totalMinutes: 600,
  startPage: 150,
  startPercent: 25,
  startMinutes: 150,
  currentPage: 300,
  currentPercent: 50,
  currentMinutes: 300,
  currentChapter: "I",
} as Reading;
const session = (id: string, endPage: number, day: string): Session =>
  ({
    id,
    editionId: "edition",
    readOn: day,
    source: "manual",
    format: "print",
    endPage,
    endPercent: endPage / 6,
    endMinutes: endPage,
    endChapter: "I",
    pagesTotal: 600,
    startedAt: null,
    endedAt: null,
    createdAt: new Date(day),
    updatedAt: new Date(day),
    durationSeconds: 1200,
    note: "Keep this",
  }) as Session;
const sessions = [
  session("first", 240, "2026-09-01"),
  session("last", 300, "2026-09-02"),
];

describe("reading edit session plan", () => {
  it.each([{ page: 180 }, { percent: 30 }, { minutes: 180 }, { page: 420 }])(
    "corrects the last log for %j without replacing its history",
    (position) => {
      const result = correctLastLog(reading, sessions, position, "II");
      expect(result.corrected).toMatchObject({
        id: "last",
        readOn: "2026-09-02",
        durationSeconds: 1200,
        note: "Keep this",
        source: "manual",
        endChapter: "II",
      });
      expect(result.sessions).toHaveLength(2);
      expect(result.sessions[0]).toBe(sessions[0]);
      expect(
        planPositions(reading, sessionOrder(result.sessions)).position.page,
      ).toBe("page" in position ? position.page : 180);
      expect(
        planPositions(reading, sessionOrder(result.sessions)).position.chapter,
      ).toBe("II");
    },
  );

  it("keeps an explicitly cleared chapter clear on later recomputation", () => {
    const nextReading = { ...reading, currentChapter: null };
    const result = correctLastLog(nextReading, sessions, undefined, null);
    expect(result.corrected.endChapter).toBe(null);
    expect(planPositions(nextReading, sessionOrder(result.sessions)).position.chapter).toBe(null);
    expect(planPositions(nextReading, sessionOrder([result.sessions[0]])).position.chapter).toBe("I");
  });

  it("maps corrections into a different session edition, keeping its page total", () => {
    const other = { ...sessions[1], editionId: "other", pagesTotal: 400 };
    const result = correctLastLog(reading, [sessions[0], other], { page: 360 });
    expect(result.corrected).toMatchObject({
      editionId: "other",
      pagesTotal: 400,
      endPage: 240,
      endPercent: 60,
    });
    expect(
      planPositions(reading, sessionOrder(result.sessions)).position.page,
    ).toBe(360);
  });

  it("refuses missing completed logs, running timers and out-of-range values", () => {
    expect(() => correctLastLog(reading, [], { page: 200 })).toThrow(
      "Log progress once",
    );
    const timer = { ...sessions[1], source: "timer", endedAt: null } as Session;
    expect(() => correctLastLog(reading, [timer], { page: 200 })).toThrow(
      "Log progress once",
    );
    expect(() =>
      correctLastLog(reading, [...sessions, timer], { page: 200 }),
    ).toThrow("Stop or discard");
    expect(() => correctLastLog(reading, sessions, { page: 601 })).toThrow(
      "past the last page",
    );
    expect(() => correctLastLog(reading, sessions, { minutes: 601 })).toThrow(
      "past the end",
    );
  });

  it.each([undefined, { page: 240 }, { percent: 40 }, { minutes: 240 }])("keeps behind-reader progress and provenance on chapter-only or unchanged-position edits: %j", (position) => {
    const effective = { ...reading, currentPage: 240, currentPercent: 40, currentMinutes: 240, currentChapter: "II" };
    const ignored = { ...session("ignored", 180, "2026-09-02"), source: "reader" } as Session;
    const result = correctLastLog(effective, [sessions[0], ignored], position, "II");
    expect(result.corrected).toMatchObject({ id: "first", source: "manual", endPage: 240, endPercent: 40, endChapter: "II" });
    expect(result.sessions[1]).toBe(ignored);
    expect(planPositions(effective, sessionOrder(result.sessions)).position).toMatchObject({ page: 240, percent: 40, chapter: "II" });
    const clearedReading = { ...effective, currentChapter: null };
    const cleared = correctLastLog(clearedReading, result.sessions, position, null);
    expect(cleared.sessions[1]).toBe(ignored);
    expect(planPositions(clearedReading, sessionOrder(cleared.sessions)).position).toMatchObject({ page: 240, chapter: null });
  });

  it("keeps minute authority through duration change, chapter correction and subsequent metadata recomputation", () => {
    const original = { ...reading, unit: "minutes" as const, format: "audio" as const, startPage: 0, startMinutes: 0, startPercent: 0 };
    const log = { ...session("audio", 300, "2026-09-01"), format: "audio" as const };
    const normalized = positionInUnit({ page: original.currentPage, minutes: original.currentMinutes, percent: original.currentPercent }, original.unit, { totalPages: 600, totalMinutes: 1200 });
    let revised = { ...original, totalMinutes: 1200, currentPage: normalized.page, currentMinutes: normalized.minutes, currentPercent: normalized.percent };
    expect(revised).toMatchObject({ currentPage: 150, currentMinutes: 300, currentPercent: 25 });
    for (const chapter of ["II", null]) {
      revised = { ...revised, currentChapter: chapter };
      const correction = correctLastLog(revised, [log], undefined, chapter);
      expect(correction.corrected).toMatchObject({ endPage: 300, endMinutes: 300, endPercent: 50, pagesTotal: 600, source: "manual" });
      const writes: Record<string, unknown>[] = [];
      const capture = { update: () => ({ set: (values: Record<string, unknown>) => ({ where: () => { writes.push(values); return {}; } }) }) };
      recomputeQueries(capture as never, revised, correction.sessions);
      expect(writes.at(-1)).toMatchObject({ currentMinutes: 300, currentPage: 150, currentPercent: 25, currentChapter: chapter });
      const metadata = { ...revised, ...writes.at(-1), rating: 4 } as Reading;
      writes.length = 0;
      recomputeQueries(capture as never, metadata, correction.sessions);
      expect(writes.at(-1)).toMatchObject({ currentMinutes: 300, currentPercent: 25, currentChapter: chapter });
    }
  });

  it.each([
    { unit: "pages", format: "print", totalPages: 1200, totalMinutes: 2400, page: 300, minutes: 600, percent: 25 },
    { unit: "minutes", format: "audio", totalPages: 600, totalMinutes: 1200, page: 150, minutes: 300, percent: 25 },
    { unit: "percent", format: "audio", totalPages: 1200, totalMinutes: 1200, page: 600, minutes: 600, percent: 50 },
    { unit: "percent", format: "print", totalPages: 1200, totalMinutes: 1200, page: 600, minutes: 600, percent: 50 },
  ] as const)("uses $unit authority without trusting the other cached counters", (scenario) => {
    const effective = { ...reading, unit: scenario.unit, format: scenario.format, totalPages: scenario.totalPages, totalMinutes: scenario.totalMinutes, startPage: 0, startMinutes: 0, startPercent: 0 };
    const log = { ...session("same", 300, "2026-09-01"), format: scenario.format };
    expect(positionInUnit({ page: 300, minutes: 300, percent: 50 }, scenario.unit, effective)).toMatchObject({ page: scenario.page, minutes: scenario.minutes, percent: scenario.percent });
    expect(planPositions(effective, [log]).position).toMatchObject({ page: scenario.page, minutes: scenario.minutes, percent: scenario.percent });
    expect(log).toMatchObject({ endPage: 300, endMinutes: 300, endPercent: 50, pagesTotal: 600 });
  });

  it("preserves precise raw percentages and absolute positions with unknown totals", () => {
    const percentReading = { ...reading, unit: "percent" as const, totalPages: 1200, totalMinutes: 1200 };
    const percentLog = { ...session("raw", 300, "2026-09-01"), endPercent: 49.99 };
    expect(planPositions(percentReading, [percentLog]).position.percent).toBe(49.99);
    const audio = { ...reading, unit: "minutes" as const, format: "audio" as const, totalPages: null, totalMinutes: null };
    const audioLog = { ...session("unknown", 300, "2026-09-01"), format: "audio" as const, endPage: null, endPercent: null };
    expect(planPositions(audio, [audioLog]).position).toMatchObject({ page: null, percent: null, minutes: 300 });
  });

  it("keeps native units when a session uses another format or edition", () => {
    const audio = { ...reading, unit: "minutes" as const, format: "audio" as const, totalMinutes: 1200 };
    const printLog = { ...session("print", 200, "2026-09-01"), editionId: "other", endPercent: 50, endMinutes: 300, pagesTotal: 400 };
    expect(planPositions(audio, [printLog]).position).toMatchObject({ page: 300, percent: 50, minutes: 600 });
    const print = { ...reading, totalMinutes: 1200 };
    const audioLog = { ...session("audio", 300, "2026-09-01"), format: "audio" as const, editionId: "other" };
    expect(planPositions(print, [audioLog]).position).toMatchObject({ page: 150, percent: 25, minutes: 300 });
  });

  it("retains the canonical revised share across later chapter edits and reader-behind decisions", () => {
    const revised = { ...reading, totalPages: 1200, startPage: 0, startPercent: 0, currentPage: 300, currentPercent: 25, currentChapter: "II" };
    const last = session("manual", 300, "2026-09-01");
    const ignored = { ...session("ignored", 180, "2026-09-02"), source: "reader" } as Session;
    const correction = correctLastLog(revised, [last, ignored], undefined, "II");
    expect(correction.corrected.id).toBe("manual");
    expect(correction.corrected.pagesTotal).toBe(600);
    expect(correction.sessions[1]).toBe(ignored);
    expect(planPositions(revised, sessionOrder(correction.sessions)).position).toMatchObject({ page: 300, percent: 25, chapter: "II" });
  });

  it.each(["II", null])("keeps the reading chapter %j when every log is ignored, without writing a reader session", (chapter) => {
    const effective = { ...reading, startPage: 400, startPercent: 66.67, startMinutes: 400, currentPage: 400, currentPercent: 66.67, currentMinutes: 400, currentChapter: chapter };
    const ignored = [240, 180].map((page, index) => ({ ...session(`reader-${index}`, page, `2026-09-0${index + 1}`), source: "reader" } as Session));
    const correction = correctLastLog(effective, ignored, undefined, chapter);
    expect(correction.writeSession).toBe(false);
    expect(correction.sessions).toBe(ignored);
    const plan = planPositions(effective, sessionOrder(correction.sessions));
    expect(plan.lastPositionSession).toBeUndefined();
    expect(plan.position).toMatchObject({ page: 400, percent: 66.67, chapter });
    expect(planPositions({ ...effective, rating: 4 }, sessionOrder(ignored)).position).toEqual(plan.position);
    expect(ignored.map((s) => ({ source: s.source, page: s.endPage, chapter: s.endChapter }))).toEqual([{ source: "reader", page: 240, chapter: "I" }, { source: "reader", page: 180, chapter: "I" }]);
  });

  it("keeps a reader log unchanged when only its displayed position is resubmitted", () => {
    const effective = { ...reading, currentPage: 240, currentPercent: 40, currentMinutes: 240 };
    const ignored = { ...session("ignored", 180, "2026-09-02"), source: "reader" } as Session;
    const result = correctLastLog(effective, [sessions[0], ignored], { page: 240 });
    expect(result.corrected).toEqual(ignored);
    expect(planPositions(effective, sessionOrder(result.sessions)).position.page).toBe(240);
  });

  it("makes explicit reader-log corrections manual while automatic reader updates keep their behind-progress rule", () => {
    const reader = { ...sessions[1], source: "reader" } as Session;
    const result = correctLastLog(reading, [sessions[0], reader], { page: 180 });
    expect(result.corrected.source).toBe("manual");
    expect(planPositions(reading, sessionOrder(result.sessions)).position.page).toBe(180);
    expect(planPositions(reading, sessionOrder([sessions[0], { ...reader, endPage: 180, endPercent: 30 }])).position.page).toBe(240);
  });
});

describe("reading edit input boundary", () => {
  const base = {
    readingId: "11111111-1111-4111-8111-111111111111",
    fingerprint: "a".repeat(32),
  };
  it.each([
    { startPage: 150 },
    { startPercent: 25 },
    { startMinutes: 150 },
    { currentChapter: "  II  " },
    { currentPosition: { page: 150 } },
  ])("accepts %j", (patch) => {
    expect(updateReadingSchema.safeParse({ ...base, ...patch }).success).toBe(
      true,
    );
  });
  it.each([
    { startPage: 1, startPercent: 1 },
    { startPage: null },
    { startPercent: 101 },
    { startPage: -1 },
    { startPage: 1.5 },
    { startMinutes: 1.5 },
    { currentPosition: {} },
    { currentPosition: { page: 1, minutes: 1 } },
    { currentPage: 150 },
    { currentChapter: " " },
    { currentChapter: "x".repeat(301) },
  ])("rejects %j", (patch) => {
    expect(updateReadingSchema.safeParse({ ...base, ...patch }).success).toBe(
      false,
    );
  });
});
