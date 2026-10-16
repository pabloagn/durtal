import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// The e-book copy's facts lead to its details, its reader, its highlights and
// its reading places. Each is a link, so each reads as one: the text-command
// colour and underline (and its 44px box on touch), never body text that only
// changes colour on a hover a phone does not have (SLN-683). Browser layout is
// measured by hand; this pins the class on every link in the e-book rows.
it("styles every link in the e-book copy's rows as a command", () => {
  const source = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/library/[slug]/instance-detail.tsx"), "utf8");
  const digital = source.slice(source.indexOf("{/* Digital details */}"));
  const links = [...digital.matchAll(/<(?:Link|ReaderEntryLink)\b[^>]*?className="([^"]*)"/g)].map((m) => m[1]);
  expect(links.length).toBeGreaterThanOrEqual(4);
  for (const className of links) expect(className.split(" ")).toContain("text-command");
});

// The #278 review's leftovers: the eBook line's commands stay whole and on its
// line (Unlink… is a text command there, not a 28px button 2px above the
// text), and the copy's size is named once
it("keeps the eBook line's commands whole and on the line, and names the size once", () => {
  const source = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/library/[slug]/instance-detail.tsx"), "utf8");
  const digital = source.slice(source.indexOf("{/* Digital details */}"));
  const line = digital.slice(0, digital.indexOf("</dd>"));
  for (const [, className] of line.matchAll(/<(?:Link|ReaderEntryLink)\b[^>]*?className="([^"]*)"/g))
    expect(className.split(" ")).toEqual(expect.arrayContaining(["whitespace-nowrap", "text-command"]));
  expect(line).toContain("<UnlinkEbookButton ebookId={ebook.id} inline />");
  expect(digital).toContain("instance.fileSizeBytes != null && !ebook?.sizeBytes");
  const button = readFileSync(path.resolve(__dirname, "../../components/ebooks/unlink-ebook-button.tsx"), "utf8");
  expect(button).toContain('className="whitespace-nowrap text-command');
  expect(line).toContain('<dd className="flex min-w-0 flex-wrap items-baseline gap-x-3 pointer-coarse:gap-x-4 pointer-coarse:gap-y-9.5 pointer-coarse:pb-1 text-fg-secondary">');
});
