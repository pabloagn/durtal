import { describe, expect, it } from "vitest";
import {
  annotationTimeMicros,
  canonicalAnnotationTime,
  compareAnnotationTimes,
  nextAnnotationServerTime,
  annotationPullWindow,
} from "@/lib/reader/sync/annotation-time";
import { at } from "./fixtures/annotation";

describe("precision-safe annotation clocks", () => {
  it("keeps writes one microsecond apart distinct", () => {
    expect(compareAnnotationTimes("2026-10-09T12:00:00.000001Z", at)).toBe(1);
    expect(canonicalAnnotationTime("2026-10-09T14:00:00.000001+02:00")).toBe(
      "2026-10-09T12:00:00.000001Z",
    );
  });
  it("advances after equal or backwards wall clocks", () => {
    expect(nextAnnotationServerTime(at, at)).toBe(
      "2026-10-09T12:00:00.000001Z",
    );
    expect(nextAnnotationServerTime(at, "2026-10-09T11:00:00Z")).toBe(
      "2026-10-09T12:00:00.000001Z",
    );
    expect(nextAnnotationServerTime("2026-10-09T12:00:00.999999Z", at)).toBe(
      "2026-10-09T12:00:01.000000Z",
    );
  });
  it("normalizes microseconds before 1970 too", () => {
    expect(canonicalAnnotationTime("1969-12-31T23:59:59.999999Z")).toBe(
      "1969-12-31T23:59:59.999999Z",
    );
    expect(annotationTimeMicros("1969-12-31T23:59:59.999999Z")).toBe(
      BigInt(-1),
    );
  });
  it("rejects invalid dates, excessive precision and invalid offsets", () => {
    for (const value of [
      "2026-02-30T12:00:00Z",
      "2026-10-09T24:00:00Z",
      "0000-01-01T00:00:00Z",
      "2026-10-09T12:00:00.0000001Z",
      "2026-10-09T12:00:00+24:00",
    ])
      expect(() => canonicalAnnotationTime(value)).toThrow();
  });
  it("uses inclusive windows and full reset at the retention boundary", () => {
    expect(annotationPullWindow(at, at)).toEqual({
      reset: false,
      since: at,
      serverTime: at,
    });
    expect(annotationPullWindow("2026-07-11T12:00:00Z", at).reset).toBe(true);
    expect(annotationPullWindow("2026-07-11T12:00:00.000001Z", at).reset).toBe(
      false,
    );
    expect(() =>
      annotationPullWindow("2026-10-09T12:00:00.000001Z", at),
    ).toThrow();
  });
});
