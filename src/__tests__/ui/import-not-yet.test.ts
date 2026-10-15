import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish pass 4, item 4 (SLN-832): the dashboard's "Import books" led
// to "Coming soon" and developer commands. Until importing books exists,
// nothing links there, and the page says so plainly.

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("book import, not built yet", () => {
  it("has no link from the dashboard or the command palette", () => {
    expect(source("app/(catalogue)/page.tsx")).not.toContain("/library/import");
    expect(source("components/layout/command-palette.tsx")).not.toContain("/library/import");
  });

  it("says plainly that it isn't available, with no developer commands", () => {
    const page = source("app/(catalogue)/library/import/page.tsx");
    expect(page).toContain('title="Importing books isn\'t available yet"');
    expect(page).toContain('href="/reading/import"');
    expect(page).not.toMatch(/Coming soon|task ingest|scripts\/ingest/);
    expect(page).toContain('export const metadata = { title: "Import" };');
  });
});
