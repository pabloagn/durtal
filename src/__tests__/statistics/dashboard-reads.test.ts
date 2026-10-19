import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-795: the dashboard's Statistics reads start with its first ones, and
// the busiest year waits only for the years, not for the other numbers

const calls = vi.hoisted(() => [] as string[]);
type Written = { years: { year: number; count: number }[]; undated: number };
const written = vi.hoisted(() => {
  const held = {} as { promise: Promise<Written>; resolve: (value: Written) => void };
  held.promise = new Promise((resolve) => { held.resolve = resolve; });
  return held;
});
vi.mock("@/lib/statistics/library", () => ({
  // Never settles: the busiest year must not wait for it
  libraryNumbers: () => { calls.push("numbers"); return new Promise(() => {}); },
  writtenYears: () => { calls.push("written"); return written.promise; },
  breakdown: () => { calls.push("breakdown"); return new Promise(() => {}); },
  busiestYears: async (years: { year: number }[]) => { calls.push(`busiest ${years.map((y) => y.year).join(",")}`); return []; },
}));

import { statisticsReads } from "@/components/statistics/dashboard-statistics";

describe("the dashboard's Statistics reads", () => {
  it("start at once, with the busiest year as soon as the years are in", async () => {
    statisticsReads();
    expect([...calls].sort()).toEqual(["breakdown", "numbers", "written"]);
    written.resolve({ years: [{ year: 1957, count: 3 }], undated: 0 });
    await vi.waitFor(() => expect(calls).toContain("busiest 1957"));
  });

  it("start before the dashboard waits on anything", () => {
    const source = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/page.tsx"), "utf8");
    const content = source.slice(source.indexOf("async function DashboardContent"));
    expect(content.indexOf("statisticsReads()")).toBeGreaterThan(-1);
    expect(content.indexOf("statisticsReads()")).toBeLessThan(content.indexOf("await"));
    expect(content).toContain("<DashboardStatistics reads={statistics} />");
  });
});
