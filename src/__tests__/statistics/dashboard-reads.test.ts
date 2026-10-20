import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-795: the dashboard's Statistics reads start with its first ones.
// SLN-1315: they are one statement, the busiest year read with the rest

const calls = vi.hoisted(() => [] as { parts: readonly string[]; options: unknown }[]);
vi.mock("@/lib/statistics/library", () => ({
  libraryStatistics: (parts: readonly string[], options: unknown) => {
    calls.push({ parts, options });
    return new Promise(() => {});
  },
}));

import { statisticsReads } from "@/components/statistics/dashboard-statistics";

describe("the dashboard's Statistics reads", () => {
  it("start at once, as one read with the busiest year in it", () => {
    statisticsReads();
    expect(calls).toEqual([{ parts: ["numbers", "written", "breakdown", "busiest"], options: { busiest: 1 } }]);
  });

  it("start before the dashboard waits on anything", () => {
    const source = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/page.tsx"), "utf8");
    const content = source.slice(source.indexOf("async function DashboardContent"));
    expect(content.indexOf("statisticsReads()")).toBeGreaterThan(-1);
    expect(content.indexOf("statisticsReads()")).toBeLessThan(content.indexOf("await"));
    expect(content).toContain("<DashboardStatistics reads={statistics} />");
  });
});
