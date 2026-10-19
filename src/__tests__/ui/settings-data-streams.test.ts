import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-940: matching every title against every series is the slowest read on
// /settings/data, so its count streams in and the page's first byte never
// waits for it. The query's own cost stays under jit_above_cost.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("Data settings", () => {
  const page = read("app/(catalogue)/settings/data/page.tsx");

  it("streams the series suggestions count, holding its place", () => {
    expect(page).toMatch(/<Suspense fallback=\{<QueueRow \{\.\.\.SERIES_QUEUE\} counting \/>\}>\s*<SeriesQueueRow \/>\s*<\/Suspense>/);
    expect(page).not.toContain("getSeriesSuggestions");
    const main = page.slice(page.indexOf("export default async function DataSettingsPage"));
    expect(main).not.toContain("seriesSuggestionCounts");
  });

  it("names each suggestion's authors from one grouped join, not a subquery a row", () => {
    const series = read("lib/actions/series.ts");
    const query = series.slice(series.indexOf("export async function getSeriesSuggestions"), series.indexOf("export async function getSeriesSuggestionScope"));
    expect(query).toContain("from work_authors wa join authors a on a.id = wa.author_id group by wa.work_id");
    expect(query).not.toContain("where wa.work_id = w.id");
  });
});
