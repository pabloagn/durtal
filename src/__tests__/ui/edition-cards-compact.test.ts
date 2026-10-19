import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-1132: an edition card on a phone was about 400px of mostly empty
// Quotes and Copies, and Add edition started in English with the work's title
// whatever the work's language. Checked in Chromium, Firefox and WebKit (the
// order has a database test, in book-links); this pins the rest.
const dir = path.resolve(__dirname, "../../app/(catalogue)/library/[slug]");
const read = (file: string) => readFileSync(path.join(dir, file), "utf8");
const card = read("edition-detail-card.tsx");
const quotes = read("edition-quotes.tsx");
const add = read("edition-add-dialog.tsx");
const form = readFileSync(path.resolve(__dirname, "../../components/books/edition-form.tsx"), "utf8");

describe("edition cards and Add edition", () => {
  it("folds an edition's empty quotes and copies into one line", () => {
    expect(card).toContain("const bare = !!quotes && edition.instances.length === 0 && quotes.quotes + quotes.notes === 0;");
    expect(card).toContain("{!bare && (");
    expect(quotes).toContain("No quotes or copies yet");
  });

  it("sets the cover beside the title from a phone's width", () => {
    expect(card).toContain("@min-[280px]:grid-cols-[64px_minmax(0,1fr)]");
  });

  it("starts a new edition in the work's language, its title the work's until one is typed", () => {
    expect(add).toContain("language: workLanguage || newBookLanguage,");
    expect(add).toContain('title: "",');
    expect(form).toContain('placeholder={work ? work.title : "Edition title..."}');
    expect(form).toContain("values.title.trim() || !work ? values : { ...values, title: work.title }");
  });

  it("ticks This is a translation when the language leaves the work's", () => {
    expect(form).toContain("...(work?.language && { isTranslated: language !== work.language }),");
  });
});
