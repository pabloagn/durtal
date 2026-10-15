import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-769: the Reading hub's Up next and Recently finished showed bare
// covers with a small sans title, at two different widths, where every other
// cover grid shows the house's work card with a serif `CardHeading`

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");
const hub = source("app/(catalogue)/reading/(tabs)/page.tsx");
const tiles = source("components/reading/reading-tiles.tsx");

describe("the Reading hub's cover rows", () => {
  it("share the catalogue grid: 208px readable minimum, two a row on a phone", () => {
    expect(hub).toMatch(/data-hub-next=""[\s\S]*?<div className="@container">\s*<ol className="catalogue-grid catalogue-density-compact">/);
    expect(hub).toMatch(/<div className="@container">\s*<FinishedCovers reads=\{finished\.map\(finishedItem\)\} className="catalogue-grid catalogue-density-compact" \/>/);
    expect(hub).not.toContain("sm:grid-cols-5");
    expect(hub).not.toContain("sm:grid-cols-6");
  });

  it("are work cards whose titles wrap in full in CardHeading", () => {
    expect(hub).toMatch(/<li key=\{item\.workId\} className=\{WORK_CARD\}[\s\S]*?<div className=\{WORK_CARD_BODY\}>[\s\S]*?<CardHeading title=\{item\.title\} \/>[\s\S]*?<QueueStartButton/);
    expect(tiles).toMatch(/<article key=\{read\.id\} className=\{WORK_CARD\} data-hub-finished=\{read\.id\}>[\s\S]*?<CardHeading title=\{read\.title\} \/>[\s\S]*?<RatingStars value=\{read\.rating\} \/>[\s\S]*?\{read\.date\}/);
  });
});
