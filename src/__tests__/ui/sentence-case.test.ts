import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// The wording survey's sentence-case sweep (SLN-851): titles, labels, menu
// items and statuses take a capital on their first word only. Proper names
// keep theirs ("Open Library key"). These were the title-case strings it
// found; none comes back.

const SRC = path.resolve(__dirname, "../..");
const TITLE_CASE = [
  "Up Next", "On Order", "Lent Out", "In Transit", "In Storage", "On Loan", "Not Available",
  "Edit Work", "Edit Edition", "Edit Instance", "Edit Taxonomy", "Add Edition", "Add Instance",
  "Add Book", "Add Film", "Add Painting", "Add Perfume", "Delete Work", "Link a Work", "Manage Media",
  "Merge Item", "Copy Name", "Title & Identifiers", "Genres & Tags", "Core Details", "Description & Notes",
  "Book Links", "Similar Works", "Associated Editions", "Edition Contributions", "Order Details",
  "Original Language", "Original Year", "Work Type", "Catalogue Status", "Acquisition Priority",
  "Series Position", "Sort Name", "First Name", "Last Name", "Real Name", "Life Dates", "Birth Place",
  "Death Place", "Birth Year", "Death Year", "Zodiac Sign", "Open Library Key", "Personal Notes",
  "Edition Name", "Edition Number", "Printing Number", "Publication Date", "Limited Edition Count",
  "Dust Jacket", "File Size", "Insert Link", "Bullet List", "Numbered List", "Code Block",
  "Clear Formatting", "Retry Undo",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : files(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("sentence case", () => {
  it("leaves none of the survey's title-case strings in the app", () => {
    const found: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const phrase of TITLE_CASE) {
        if (new RegExp(`(?<![A-Za-z])${phrase.replace(/[&]/g, "\\$&")}(?![a-z])`).test(text)) found.push(`${path.relative(SRC, file)}: ${phrase}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("names a new taxonomy item by its family, not \"New … Item\"", () => {
    const dialog = readFileSync(path.join(SRC, "components/taxonomy/create-item-dialog.tsx"), "utf8");
    expect(dialog).toContain("title={`Add to ${familyName}`}");
  });
});

// Section 6: no line starts with punctuation
describe("separators that wrap", () => {
  it("keeps each file extension in the dictionary note with the word before it", () => {
    const note = readFileSync(path.join(SRC, "app/(catalogue)/settings/reader/dictionaries.tsx"), "utf8");
    expect(note).toContain("a&nbsp;.zip, or its&nbsp;.ifo,&nbsp;.idx and&nbsp;.dict files");
  });
});
