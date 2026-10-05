import { describe, expect, it } from "vitest";
import { formatMinutes, parseProgressInput, percentOf, remapPosition } from "@/lib/reading/positions";

const pages = { unit: "pages" as const, totalPages: 480, totalMinutes: null };
const audio = { unit: "minutes" as const, totalPages: null, totalMinutes: 600 };

describe("percentOf", () => {
  it("reads pages, minutes, or the percent itself, rounded to 2 decimals", () => {
    expect(percentOf({ page: 212 }, { totalPages: 480 })).toBe(44.17);
    expect(percentOf({ minutes: 192 }, { totalMinutes: 600 })).toBe(32);
    expect(percentOf({ percent: 12.345 }, {})).toBe(12.35);
    expect(percentOf({ page: 212 }, {})).toBeNull();
    expect(percentOf({}, { totalPages: 480 })).toBeNull();
  });
});

describe("remapPosition", () => {
  it("maps a share onto another edition or format", () => {
    expect(remapPosition(44.17, { totalPages: 448 })).toEqual({ page: 198, minutes: null, percent: 44.17 });
    expect(remapPosition(50, { totalPages: 400, totalMinutes: 600 })).toEqual({ page: 200, minutes: 300, percent: 50 });
  });
  it("gives no page without a page count, and keeps the share", () => {
    expect(remapPosition(30, { totalPages: null })).toEqual({ page: null, minutes: null, percent: 30 });
    expect(remapPosition(null, { totalPages: 300 })).toEqual({ page: null, minutes: null, percent: null });
  });
});

describe("parseProgressInput", () => {
  it("understands every form of a page", () => {
    for (const text of ["212", "p 212", "p. 212", "page 212", "P212", " 212 "])
      expect(parseProgressInput(text, pages)).toEqual({ ok: true, value: { kind: "page", page: 212 } });
    expect(parseProgressInput("212/480", { ...pages, totalPages: null })).toEqual({
      ok: true,
      value: { kind: "page", page: 212, totalPages: 480 },
    });
  });
  it("reads a percent, rounding it", () => {
    expect(parseProgressInput("44%", pages)).toEqual({ ok: true, value: { kind: "percent", percent: 44 } });
    expect(parseProgressInput("44,567 %", pages)).toEqual({ ok: true, value: { kind: "percent", percent: 44.57 } });
    expect(parseProgressInput("101%", pages)).toEqual({ ok: false, error: "Enter 0 to 100%" });
  });
  it("sends a relative step as pages on, or minutes on for an audiobook", () => {
    expect(parseProgressInput("+20", pages)).toEqual({ ok: true, value: { kind: "addPages", pages: 20 } });
    expect(parseProgressInput("+ 20", audio)).toEqual({ ok: true, value: { kind: "addMinutes", minutes: 20 } });
  });
  it("reads audio times", () => {
    expect(parseProgressInput("3:12", audio)).toEqual({ ok: true, value: { kind: "minutes", minutes: 192 } });
    expect(parseProgressInput("3h12", audio)).toEqual({ ok: true, value: { kind: "minutes", minutes: 192 } });
    expect(parseProgressInput("3h", audio)).toEqual({ ok: true, value: { kind: "minutes", minutes: 180 } });
    expect(parseProgressInput("45 min", audio)).toEqual({ ok: true, value: { kind: "minutes", minutes: 45 } });
    expect(parseProgressInput("192", audio)).toEqual({ ok: true, value: { kind: "minutes", minutes: 192 } });
    expect(parseProgressInput("11:00", audio)).toEqual({ ok: false, error: "11:00 is past the end, 10:00" });
  });
  it("reads a chapter", () => {
    expect(parseProgressInput("ch 7", pages)).toEqual({ ok: true, value: { kind: "chapter", chapter: "7" } });
    expect(parseProgressInput("Chapter Seven", pages)).toEqual({ ok: true, value: { kind: "chapter", chapter: "Seven" } });
  });
  it("reads a bare number in the reading's unit", () => {
    expect(parseProgressInput("44", { unit: "percent", totalPages: null, totalMinutes: null })).toEqual({
      ok: true,
      value: { kind: "percent", percent: 44 },
    });
  });
  it("refuses a page past the last one, and anything it cannot read", () => {
    expect(parseProgressInput("512", pages)).toEqual({ ok: false, error: "Page 512 is past the last page, 480" });
    expect(parseProgressInput("212/0", pages).ok).toBe(false);
    expect(parseProgressInput("", pages).ok).toBe(false);
    expect(parseProgressInput("halfway", pages)).toEqual({
      ok: false,
      error: "Enter a page (212), a percent (44%), a time (3:12) or a chapter (ch 7)",
    });
  });
  it("writes minutes as hours and minutes", () => {
    expect(formatMinutes(192)).toBe("3:12");
    expect(formatMinutes(5)).toBe("0:05");
  });
});
