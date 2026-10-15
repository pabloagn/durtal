import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish, 15 Oct: Reading's "Currently reading" card took a third of
// the column (357px at 1440), so Open eBook sat on a line of its own over Log
// progress, the timer and the menu.
const page = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/reading/page.tsx"), "utf8");

it("gives each currently reading card at least 30rem", () => {
  const section = page.slice(page.indexOf('<SectionHeading title="Currently reading"'), page.indexOf("<CurrentReadingCard"));
  expect(section).toContain('className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,30rem),1fr))] gap-4"');
});

// Review of #359: side by side, a card whose title wrapped to three lines had
// its actions 28.8px lower than its neighbour's
it("puts a currently reading card's actions at its foot beside the cover", () => {
  const cards = readFileSync(path.resolve(__dirname, "../../components/reading/hub-cards.tsx"), "utf8");
  const card = cards.slice(cards.indexOf("<article className=\"@container grid grid-cols-[4rem"), cards.indexOf("data-hub-open-ebook"));
  expect(card).toContain("@[280px]:grid-rows-[auto_1fr]");
  expect(card).toMatch(/@\[280px\]:col-start-2 @\[280px\]:self-end"/);
});
