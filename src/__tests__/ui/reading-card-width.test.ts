import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish, 15 Oct: Reading's "Currently reading" card took a third of
// the column (357px at 1440), so Open eBook sat on a line of its own over Log
// progress, the timer and the menu.
const page = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/reading/(tabs)/page.tsx"), "utf8");

it("gives each currently reading card at least 30rem", () => {
  const section = page.slice(page.indexOf('<SectionHeading title="Currently reading"'), page.indexOf("<CurrentReadingCard"));
  expect(section).toContain('className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,30rem),1fr))] gap-4"');
});
