import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Follow-ups from the reviews of #362 and #364 (SLN-792)
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

it("pulls Show 50 more and the dictionaries' Cancel out by their padding", () => {
  expect(read("app/(catalogue)/settings/reader/lookup-history.tsx")).toContain('{(entries.length < count || error) && <div className="-ml-3 flex flex-wrap gap-3">');
  const dictionaries = read("app/(catalogue)/settings/reader/dictionaries.tsx");
  expect(dictionaries).toContain('<div className="mt-3 flex flex-col items-start gap-3 sm:flex-row">');
  expect(dictionaries).toContain('className="-ml-2.5 sm:ml-0" onClick={() => operation.current?.abort()}');
});

it("counts one eBook, one review row and thousands of suggestions in words", () => {
  expect(read("app/(catalogue)/ebooks/page.tsx")).toContain('{counts.active === 1 ? "eBook" : "eBooks"}');
  const dialog = read("components/ebooks/review-all-dialog.tsx");
  expect(dialog).toContain('{unavailable.length === 1 ? "review row" : "review rows"}');
  expect(dialog).toContain('remaining.length === 1 ? "Review this eBook"');
  expect(read("components/ebooks/ebook-suggestion-line.tsx")).toContain('{count.toLocaleString("en")} {count === 1 ? "eBook suggestion"');
});
