// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  QUOTE_CHARS,
  locatorFromRelocate,
  placeCfi,
  quoteAt,
} from "@/lib/reader/engines/foliate/locator";
import * as CFI from "@/vendor/foliate-js/epubcfi.js";

/* SLN-492: DurtalLocators from the engine's places, with the text at the place */

const hash = "b".repeat(64);

function page(html: string) {
  document.body.innerHTML = html;
  return document.body;
}

describe("locatorFromRelocate", () => {
  it("keeps the CFI, the progressions within 0 to 1, and trimmed labels", () => {
    expect(
      locatorFromRelocate({
        fileHash: hash,
        sectionIndex: 3,
        href: "OEBPS/ch3.xhtml",
        sectionFraction: 1.2,
        fraction: -0.1,
        location: 42,
        cfi: "epubcfi(/6/8!/4/2/1:0)",
        tocLabel: "  Chapter III  ",
        pageLabel: " 139 ",
      }),
    ).toEqual({
      v: 1,
      fileHash: hash,
      href: "OEBPS/ch3.xhtml",
      sectionIndex: 3,
      progression: 1,
      totalProgression: 0,
      position: 43,
      cfi: "epubcfi(/6/8!/4/2/1:0)",
      tocLabel: "Chapter III",
      pageLabel: "139",
    });
  });

  it("gives a PDF its page instead of a CFI or a quote", () => {
    page("<p>Some text on the page</p>");
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("p")!);
    const locator = locatorFromRelocate({
      fileHash: hash,
      sectionIndex: 4,
      href: "4",
      sectionFraction: 0,
      fraction: 0.5,
      pdfPage: 5,
      cfi: "x",
      range,
    });
    expect(locator.pdf).toEqual({ page: 5 });
    expect(locator.cfi).toBeUndefined();
    expect(locator.text).toBeUndefined();
  });

  it("reads a progression that is not a number as 0", () => {
    expect(
      locatorFromRelocate({
        fileHash: hash,
        sectionIndex: 0,
        href: "a",
        sectionFraction: Number.NaN,
        fraction: 0.25,
      }),
    ).toMatchObject({
      progression: 0,
      totalProgression: 0.25,
    });
  });
});

describe("placeCfi (SLN-676)", () => {
  it("saves the start point of the visible range", () => {
    expect(placeCfi("epubcfi(/6/2!/4/124,,/2)")).toBe("epubcfi(/6/2!/4/124)");
    expect(placeCfi("epubcfi(/6/4!/4,/178/1:253,/186/1:85)")).toBe("epubcfi(/6/4!/4/178/1:253)");
    expect(placeCfi("epubcfi(/6/4!/4/10/1:5)")).toBe("epubcfi(/6/4!/4/10/1:5)");
    expect(placeCfi("not a cfi")).toBe("not a cfi");
    expect(
      locatorFromRelocate({ fileHash: hash, sectionIndex: 1, href: "1", sectionFraction: 0, fraction: 0.27, cfi: "epubcfi(/6/2!/4/124,,/2)" }).cfi,
    ).toBe("epubcfi(/6/2!/4/124)");
  });

  it("anchors a page that starts on an image at that image's block", () => {
    const body = page('<p>Before.</p><div id="plate"><img alt="Plate" src="data:,"></div><p>After.</p>');
    const plate = body.querySelector("#plate")!;
    // The visible range of an image page: from the block's start to the image's start
    const visible = document.createRange();
    visible.setStart(plate, 0);
    visible.setEnd(plate.querySelector("img")!, 0);
    const saved = placeCfi(CFI.fromRange(visible));
    const point = CFI.toRange(document, CFI.parse(saved));
    expect(point?.collapsed).toBe(true);
    expect(point?.startContainer).toBe(plate);
  });
});

describe("quoteAt", () => {
  it("takes the first words of the page and the text on either side", () => {
    page(
      "<p>It was a dark night.</p><p>The <em>rain</em> fell on Fontenay and on the house.</p>",
    );
    const second = document.querySelectorAll("p")[1];
    const range = document.createRange();
    range.setStart(second.firstChild!, 0);
    range.setEnd(second.lastChild!, 8);
    expect(quoteAt(range)).toEqual({
      before: "It was a dark night.",
      highlight: "The rain fell on",
      after: " Fontenay and on the house.",
    });
  });

  it("cuts a whole page to its first 64 characters, with what follows as context", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    page(`<p>${words}</p>`);
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("p")!);
    const quote = quoteAt(range)!;
    expect(quote.highlight).toHaveLength(QUOTE_CHARS);
    expect(words.startsWith(quote.highlight!)).toBe(true);
    expect(quote.after).toHaveLength(QUOTE_CHARS);
    expect(words.slice(QUOTE_CHARS).startsWith(quote.after!)).toBe(true);
    expect(quote.before).toBeUndefined();
  });

  it("reads forward from a collapsed place, and gives nothing on a blank page", () => {
    page("<p>Alpha beta gamma.</p>");
    const range = document.createRange();
    range.setStart(document.querySelector("p")!.firstChild!, 6);
    expect(quoteAt(range)).toEqual({
      before: "Alpha ",
      highlight: "beta gamma.",
    });

    page("<p>   </p>");
    const blank = document.createRange();
    blank.selectNodeContents(document.querySelector("p")!);
    expect(quoteAt(blank)).toBeUndefined();
  });
});

it("quotes the complete selection with context from its end", async () => {
  const { quoteFromSelection } =
    await import("@/lib/reader/engines/foliate/locator");
  const doc = document;
  const before = "Before the passage ".repeat(5),
    selected = "The selected passage ".repeat(12),
    after = "After the passage ".repeat(5);
  doc.body.textContent = before + selected + after;
  const range = doc.createRange();
  range.setStart(doc.body.firstChild!, before.length);
  range.setEnd(doc.body.firstChild!, before.length + selected.length);
  const quote = quoteFromSelection(range)!;
  expect(quote.highlight).toBe(selected.trim());
  expect(quote.before).toBe(before.slice(-64));
  expect(quote.after).toBe(after.slice(0, 64));
});
