import { describe, expect, it } from "vitest";
import { instantISO, instantMicros, readingDate, sqlDateDays } from "@/lib/export/instants";

describe("exact native export dates", () => {
  it.each([
    ["0", "1970-01-01T00:00:00.000000Z"],
    ["-1", "1969-12-31T23:59:59.999999Z"],
    ["123456", "1970-01-01T00:00:00.123456Z"],
    ["-62135596800000000", "0001-01-01T00:00:00.000000Z"],
    ["-62167219200000000", "0000-01-01T00:00:00.000000Z"],
    ["9007199254740993", "2255-06-05T23:47:34.740993Z"],
  ])("formats %s without Date or floating point", (micros, iso) => {
    expect(instantISO(micros)).toBe(iso);
    expect(instantMicros(micros)).toBe(BigInt(micros));
  });

  it.each([0, -1, new Date(0), "1.0", "01", "-0", "1e6", "9223372036854775808", "-9223372036854775809"])("rejects a lossy or invalid instant %s", (value) => {
    expect(() => instantMicros(value)).toThrow();
  });

  it("retains partial, BCE and absent reading dates without inventing a day", () => {
    expect(readingDate("2024-01-01", "year")).toMatchObject({ precision: "year", start: { year: 2024, month: null, day: null } });
    expect(readingDate("2024-02-01", "month")).toMatchObject({ precision: "month", start: { year: 2024, month: 2, day: null } });
    expect(readingDate("0001-01-01 BC", "day")).toMatchObject({ start: { year: -1, month: 1, day: 1 } });
    expect(readingDate(null, "unknown")).toBeNull();
    expect(sqlDateDays("1970-01-01")).toBe(0);
    expect(sqlDateDays("1969-12-31")).toBe(-1);
    expect(sqlDateDays("0001-01-01 BC")).toBe(-719528);
    expect(() => readingDate("2023-02-29", "day")).toThrow();
  });
});
