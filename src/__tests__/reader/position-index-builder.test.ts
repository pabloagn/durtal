// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
  buildAnchorIndex,
  scanMarkup,
} from "@/lib/reader/engines/foliate/position-index";
import {
  findPageMap,
  parsePageMap,
} from "@/lib/reader/engines/foliate/page-map";
import { visibleOriginRange } from "@/lib/reader/engines/foliate/locator";
import type { FoliateBook } from "@/lib/reader/engines/foliate/foliate";
describe("raw anchor indexing", () => {
  it("indexes a KF8 object fragment after raw loading supplies its identifier", async () => {
    const text = "<body><p>Introduction</p><p aid='chapter'>Chapter</p></body>";
    let loaded = false;
    const book: FoliateBook = {
      sections: [
        {
          id: 0,
          size: text.length,
          loadText: async () => {
            loaded = true;
            return text;
          },
        },
      ],
      splitTOCHref: () => [0, { fid: 1, off: 5 }],
      resolveHref: () => null,
      indexFragment: () => (loaded ? "chapter" : ""),
    };
    const entries = [];
    for await (const entry of buildAnchorIndex({
      book,
      fractions: [0, 1],
      hrefs: ["kindle:pos:fid:1:off:5"],
      signal: new AbortController().signal,
    }))
      entries.push(entry);
    expect(entries[0].fraction).toBeCloseTo(
      text.indexOf("<p aid=") / text.length,
    );
  });
  it("finds both quoting styles, names and FB2 IDs without creating a DOM", async () => {
    const text =
      '<html><title>Là-bas</title><body><h1>Le début</h1><p id=\'one\'>first</p><p name="two">second</p><p data-foliate-id="3">third</p></body></html>';
    const result = await scanMarkup(
      text,
      ["one", "two", "3"],
      new AbortController().signal,
    );
    expect(result.offsets.one).toBe(text.indexOf("<p id="));
    expect(result.offsets.two).toBe(text.indexOf("<p name="));
    expect(result.offsets["3"]).toBe(text.indexOf("<p data-foliate-id="));
    expect(result.label).toBe("Le début");
  });
  it("gives missing/no anchors their section start and gives notes zero share", async () => {
    const createDocument = vi.fn();
    const book: FoliateBook = {
      sections: [
        {
          id: "a",
          size: 100,
          loadText: async () => "<p id='one'>Text</p>",
          createDocument,
        },
        {
          id: "notes",
          size: 100,
          linear: "no",
          loadText: async () => "<p id='note'>Notes</p>",
          createDocument,
        },
      ],
      splitTOCHref: (href) => href.split("#") as [string, string],
      resolveHref: () => null,
    };
    const entries = [];
    for await (const entry of buildAnchorIndex({
      book,
      fractions: [0.2, 0.8, 0.8],
      hrefs: ["a", "a#missing", "notes#note"],
      signal: new AbortController().signal,
    }))
      entries.push(entry);
    expect(entries.map((entry) => entry.fraction)).toEqual([0.2, 0.2, 0.8]);
    expect(createDocument).not.toHaveBeenCalled();
  });
  it("honours cancellation before parsing and never starts another section", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(scanMarkup("<p>Text</p>", [], abort.signal)).rejects.toThrow(
      "Cancelled",
    );
    const scanSection = vi.fn();
    const book: FoliateBook = {
      sections: [{ id: "a", size: 100 }],
      resolveHref: () => null,
    };
    const entries = [];
    for await (const entry of buildAnchorIndex({
      book,
      fractions: [0, 1],
      hrefs: ["a"],
      signal: abort.signal,
      scanSection,
    }))
      entries.push(entry);
    expect(entries).toEqual([]);
    expect(scanSection).not.toHaveBeenCalled();
  });
});
describe("Adobe print pages", () => {
  it("keeps Roman labels and resolves against the map folder, skipping unusable entries", () => {
    expect(
      parsePageMap(
        '<page-map><page name="xii" href="../text.xhtml#p12"/><page name="57" href="chapter.xhtml#page57"/><page name="" href="bad"/><page name="2"/><page name="3" href="https://external.invalid/"/></page-map>',
        "OEBPS/maps/pages.xml",
      ),
    ).toEqual([
      { label: "xii", href: "OEBPS/text.xhtml#p12", subitems: [] },
      { label: "57", href: "OEBPS/maps/chapter.xhtml#page57", subitems: [] },
    ]);
  });
  it("finds the spine idref before the media-type fallback", () => {
    const opf = new DOMParser().parseFromString(
      '<package><spine page-map="map"/></package>',
      "application/xml",
    );
    const resources = {
      opf,
      manifest: [
        { href: "fallback.xml", mediaType: "application/oebps-page-map+xml" },
      ],
      getItemByID: () => ({ href: "chosen.xml" }),
    };
    expect(findPageMap({ resources })).toBe("chosen.xml");
    opf.querySelector("spine")!.removeAttribute("page-map");
    expect(findPageMap({ resources })).toBe("fallback.xml");
  });
});
describe("return outline", () => {
  it("cuts at 80 visible characters and at the first paragraph's end, including a body-start range", () => {
    const doc = document;
    doc.body.innerHTML =
      "<p>" + "a".repeat(120) + "</p><p>Second paragraph</p>";
    const long = doc.createRange();
    long.selectNodeContents(doc.body);
    expect(visibleOriginRange(long).toString()).toBe("a".repeat(80));
    doc.body.innerHTML = "<p>Short paragraph</p><p>" + "b".repeat(120) + "</p>";
    const short = doc.createRange();
    short.selectNodeContents(doc.body);
    expect(visibleOriginRange(short).toString()).toBe("Short paragraph");
  });
});
