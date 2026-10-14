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
