import { describe, expect, it } from "vitest";
import { duplicateVerdict, duplicateVerdicts, type ExistingReading } from "@/lib/reading/duplicates";

const read = (id: string, over: Partial<ExistingReading> = {}): ExistingReading => ({
  id,
  sourceKey: null,
  status: "finished",
  finishedOn: null,
  finishedPrecision: "unknown",
  ...over,
});
const dated = (id: string, on: string, precision: "day" | "month" | "year" = "day") =>
  read(id, { finishedOn: on, finishedPrecision: precision });

describe("duplicateVerdict", () => {
  it("finds the same reading and the same source", () => {
    expect(duplicateVerdict({ readingId: "a", status: "finished", finishedPrecision: "unknown" }, [read("a")])).toEqual({
      verdict: "already_present",
      match: { readingId: "a", reason: "Same reading" },
    });
    expect(
      duplicateVerdict({ sourceKey: "goodreads:1#1", status: "finished", finishedPrecision: "unknown" }, [read("a", { sourceKey: "goodreads:1#1" })]),
    ).toEqual({ verdict: "already_present", match: { readingId: "a", reason: "Same source" } });
  });
  it("finds the same read at the coarser precision", () => {
    const day = { status: "finished" as const, finishedOn: "2019-04-14", finishedPrecision: "day" as const };
    expect(duplicateVerdict(day, [dated("a", "2019-04-14")]).verdict).toBe("already_present");
    expect(duplicateVerdict(day, [dated("a", "2019-04-01", "month")]).match?.reason).toBe("Same finish date");
    expect(duplicateVerdict(day, [dated("a", "2019-01-01", "year")]).verdict).toBe("already_present");
    expect(duplicateVerdict(day, [dated("a", "2019-05-14")]).verdict).toBe("new");
    expect(duplicateVerdict(day, [dated("a", "2019-03-01", "month")]).verdict).toBe("new");
  });
  it("never matches an abandoned read with a finished one", () => {
    expect(
      duplicateVerdict({ status: "abandoned", finishedOn: "2019-04-14", finishedPrecision: "day" }, [dated("a", "2019-04-14")]).verdict,
    ).toBe("new");
  });
  it("calls an undated read against a dated reading a possible duplicate", () => {
    expect(duplicateVerdict({ status: "finished", finishedPrecision: "unknown" }, [dated("a", "2019-04-14")])).toEqual({
      verdict: "possible_duplicate",
      match: { readingId: "a", reason: "Undated read" },
    });
  });
  it("creates only the undated reads beyond those already there, with the count rule", () => {
    const existing = [dated("dated", "2019-04-14"), read("undated")];
    const file = [
      { status: "finished" as const, finishedOn: "2019-04-14", finishedPrecision: "day" as const },
      { status: "finished" as const, finishedPrecision: "unknown" as const },
      { status: "finished" as const, finishedPrecision: "unknown" as const },
    ];
    expect(duplicateVerdicts(file, existing, { countRule: true }).map((v) => v.verdict)).toEqual([
      "already_present",
      "already_present",
      "new",
    ]);
    expect(duplicateVerdict(file[2], existing, { otherRows: file.slice(0, 2), countRule: true }).verdict).toBe("new");
  });
  it("finds an open row by the open reading's id", () => {
    expect(
      duplicateVerdict({ readingId: "open", status: "reading", finishedPrecision: "unknown" }, [read("open", { status: "reading" })]).verdict,
    ).toBe("already_present");
    expect(duplicateVerdict({ status: "reading", finishedPrecision: "unknown" }, [read("open", { status: "reading" })]).verdict).toBe("new");
  });
  it("matches an existing reading to one row only", () => {
    const rows = [
      { status: "finished" as const, finishedOn: "2019-04-14", finishedPrecision: "day" as const },
      { status: "finished" as const, finishedOn: "2019-04-14", finishedPrecision: "day" as const },
    ];
    expect(duplicateVerdicts(rows, [dated("a", "2019-04-14")]).map((v) => v.verdict)).toEqual(["already_present", "new"]);
  });
});
