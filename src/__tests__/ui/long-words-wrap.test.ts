// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import path from "path";
import { RecordField } from "@/components/shared/detail-layout";
import { FactsRow } from "@/components/shared/facts-row";

// A name that is one 50-letter word pushed seven pages 35 to 190px past a
// phone's screen (findings/long-word-survey-2026-10-15.md). Each spot below
// lets such a word break. Browser behaviour is measured by hand; this pins
// the class it rests on.
const word = "A".repeat(50);
const classes = (el: Element) => el.className.split(" ");

it("breaks a long word in a record's side facts and in a header's facts line", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(RecordField, { label: "Sort name", children: word }));
  expect(classes(host.querySelector("dd")!)).toContain("[overflow-wrap:anywhere]");
  host.innerHTML = renderToStaticMarkup(createElement(FactsRow, { facts: [word, "Founded 1961"] }));
  expect(classes(host.querySelector("p")!)).toContain("[overflow-wrap:anywhere]");
});

const source = (file: string) => readFileSync(path.resolve(__dirname, "../../app/(catalogue)", file), "utf8");
/** The line of `file` that holds `marker`, the first one after `after` */
const line = (file: string, marker: string, after = "") => {
  const text = source(file);
  const at = text.indexOf(marker, text.indexOf(after));
  expect(at, `${marker} in ${file}`).toBeGreaterThan(-1);
  return text.slice(text.lastIndexOf("\n", at), text.indexOf("\n", at));
};

it.each([
  ["an edition's tag row", "library/[slug]/edition-detail-card.tsx", '<div className="flex flex-wrap gap-1.5', 'title="Tags"'],
  ["a museum's place line", "places/[slug]/page.tsx", '<p className="mb-2 flex items-start gap-1.5'],
  ["a museum's tag row", "places/[slug]/page.tsx", '<div className="flex flex-wrap items-center gap-2'],
  ["a series' authors line", "series/[id]/page.tsx", 'data-series-authors=""'],
  ["a shelf's address link", "locations/location-card.tsx", 'className="mt-1 block text-xs'],
])("breaks a long word in %s", (_, file, marker, after?: string) => {
  expect(line(file, marker, after)).toContain("[overflow-wrap:anywhere]");
});
