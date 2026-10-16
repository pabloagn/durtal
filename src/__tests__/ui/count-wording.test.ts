import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { countLabel } from "@/lib/utils/format";
import { pagerNoun } from "@/components/shared/pagination";

// From findings/wording-survey-2026-10-15.md: counts that read "1 works",
// thousands left ungrouped, "0 pp." and stored values shown as they are kept

it("puts a count's noun in the right form and groups its thousands", () => {
  expect(countLabel(0, "book")).toBe("0 books");
  expect(countLabel(1, "book")).toBe("1 book");
  expect(countLabel(1200, "page")).toBe("1,200 pages");
  expect(countLabel(1, "copy", "copies")).toBe("1 copy");
  expect(countLabel(3, "copy", "copies")).toBe("3 copies");
  expect(countLabel(1, "new series", "new series")).toBe("1 new series");
});

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

it("summarises a bar chart with each bar's own caption", () => {
  const chart = source("components/reading/charts/bar-chart.tsx");
  expect(chart).toContain('bars.map((b) => b.text).join("; ")');
  expect(chart).not.toContain("summaryUnit");
});

it("leaves no count template fixed in the plural", () => {
  for (const [file, text] of [
    ["components/ebooks/review-bulk-dialog.tsx", "} new authors"],
    ["components/authors/authors-map.tsx", ".length} authors"],
    ["app/(catalogue)/series/suggestions/page.tsx", "} books match"],
    ["components/taxonomy/merge-dialog.tsx", "entityCount} works"],
    ["components/books/add-to-collection-dialog.tsx", "length} editions selected"],
    ["components/books/bulk-action-toolbar.tsx", "length} works before"],
    ["app/(catalogue)/settings/reading/reading-settings.tsx", "Minutes} minutes"],
    ["app/(catalogue)/settings/reading/ebooks/reader-history-recovery.tsx", "} readings"],
  ]) expect(source(file), file).not.toContain(text);
});

it("groups Harmonize's remaining count and never offers more than remain", () => {
  const workspace = source("app/(catalogue)/harmonize/workspace.tsx");
  expect(workspace).toContain('Show {Math.min(60, total - visible.length)} more · {(total - visible.length).toLocaleString("en")} remaining');
});

it("shows no page count in the Add book confirm step when it is 0 or empty", () => {
  const confirm = source("app/(catalogue)/library/new/steps/confirm-step.tsx");
  expect(confirm).toContain('{Number(edition.pageCount) > 0 && <span>{countLabel(Number(edition.pageCount), "page")}</span>}');
  expect(confirm).not.toContain("pp.");
});

it("words stored values a reader sees", () => {
  // Settings > About: the migration's number, not its file name
  expect(source("app/(catalogue)/settings/about/page.tsx")).toContain('migrations.latest.split("_")[0]');
  // A recovery operation's status, in words
  expect(source("app/(catalogue)/settings/reading/ebooks/reader-history-recovery.tsx")).toContain("{OPERATION_STATUS[operation.status]");
  // A copy's location, "Study, physical", not "Study (physical)"
  expect(source("components/books/instance-form.tsx")).not.toContain("(${l.type})");
});

// From findings/counts-survey-2026-10-16.md: the pager's noun, and six counts
// printed without their thousands grouped
it("names one item in the pager", () => {
  expect(pagerNoun("publishers", 1)).toBe("publisher");
  expect(pagerNoun("publishers", 2)).toBe("publishers");
  expect(pagerNoun("people", 1)).toBe("person");
  expect(pagerNoun("series", 1)).toBe("series");
  expect(pagerNoun("quotes and notes", 1)).toBe("quote or note");
  expect(pagerNoun("eBooks", 1)).toBe("eBook");
  expect(source("components/shared/pagination.tsx")).toContain("{pagerNoun(noun, total)}");
});

it("groups the thousands of every count it shows", () => {
  expect(source("components/organizations/organization-filters.tsx")).toContain("{count.toLocaleString(\"en\")}");
  const harmonize = source("app/(catalogue)/harmonize/workspace.tsx");
  expect(harmonize).toContain("<span>{count.toLocaleString(\"en\")}</span>");
  expect(harmonize).toContain("<b>{r.count.toLocaleString(\"en\")}</b>");
  expect(harmonize).toContain("(scan?.counts.ready || 0).toLocaleString(\"en\")");
  expect(harmonize).toContain('"linked record")');
  expect(source("app/(catalogue)/locations/location-card.tsx")).toContain('{countLabel(itemCount, "item")}');
  expect(source("components/shared/selection-toolbar.tsx")).toContain("{selectedCount.toLocaleString(\"en\")}");
  const edition = source("app/(catalogue)/library/[slug]/edition-detail-card.tsx");
  expect(edition).toContain("Number(edition.pageCount).toLocaleString(\"en\")");
  expect(edition).toContain("Number(edition.limitedEditionCount).toLocaleString(\"en\")");
});

// Review of #448: the merge summary, a dictionary's word count and a recovery's date
it("words the merge summary, word counts and recovery dates the app's way", () => {
  const harmonize = source("app/(catalogue)/harmonize/workspace.tsx");
  expect(harmonize).toContain('{countLabel(filled.length, "missing field")}');
  expect(harmonize).toContain('{countLabel(conflicts.length, "field choice")}');
  const dictionaries = source("app/(catalogue)/settings/reader/dictionaries.tsx");
  expect(dictionaries).not.toContain("toLocaleString()");
  expect(dictionaries).toContain('{countLabel(metadata.wordCount, "word")}');
  expect(dictionaries).toContain('{countLabel(record.wordCount, "word")}');
  const recovery = source("app/(catalogue)/settings/reading/ebooks/reader-history-recovery.tsx");
  expect(recovery).not.toContain("toLocaleDateString()");
  expect(recovery).toContain('formatReadingDate(calendarDate(new Date(operation.createdAt)), "day")');
});
