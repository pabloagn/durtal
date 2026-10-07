import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { comicPages, inspectCbz } from "@/lib/ebooks/ingest/inspect/cbz";
import { inspectFb2 } from "@/lib/ebooks/ingest/inspect/fb2";
import { inspectMobi } from "@/lib/ebooks/ingest/inspect/mobi";
import { inspectPdf } from "@/lib/ebooks/ingest/inspect/pdf";
import { bytesSource } from "@/lib/ebooks/ingest/source";
import { makeCbz, makeFb2, makeImage, makeMobi, makePdf, makeXmp, makeZip } from "../../fixtures/ebook-builders";

/* SLN-494: MOBI and AZW3 EXTH, PDF info and XMP, ComicInfo.xml, FB2 title-info and publish-info */

describe("MOBI and AZW3", () => {
  it("reads the EXTH fields", async () => {
    const exth: [number, string][] = [
      [100, "Anna Vale"],
      [101, "River Press"],
      [103, "<p>A house.</p>"],
      [104, "9780306406157"],
      [105, "Fiction"],
      [106, "2004-05-01"],
      [113, "B000FC1234"],
      [503, "The House by the River: Updated"],
      [524, "fr"],
    ];
    const result = await inspectMobi(bytesSource(makeMobi({ exth, version: 8, cover: await makeImage("jpeg") }), "book.azw3"), "azw3");
    expect(result.drm).toBeNull();
    expect(result.metadata).toMatchObject({
      title: "The House by the River: Updated",
      publisher: "River Press",
      description: "<p>A house.</p>",
      subjects: ["Fiction"],
      date: "2004-05-01",
      language: "fr",
      authors: [{ name: "Anna Vale", role: "aut" }],
    });
    expect(result.metadata.identifiers).toEqual([
      { scheme: "isbn", value: "9780306406157" },
      { scheme: "asin", value: "B000FC1234" },
    ]);
    expect(result.cover).not.toBeNull();
    expect((await result.cover!.load()).subarray(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(result.text?.kind).toBe("html");
  });

  it("falls back to the header's title and locale", async () => {
    const result = await inspectMobi(bytesSource(makeMobi({ title: "Plain Title", locale: 10 }), "plain.mobi"), "mobi");
    expect(result.metadata).toMatchObject({ title: "Plain Title", language: "es" });
  });

  it("gives no text for HUFF/CDIC compression, with the reason", async () => {
    const result = await inspectMobi(bytesSource(makeMobi({ compression: 17480 }), "huff.mobi"), "mobi");
    expect(result.text).toEqual({ kind: "none", reason: "MOBI with HUFF/CDIC compression: its text is not read" });
  });
});

describe("PDF", () => {
  it("reads the info dictionary, the page count and whether it is linearized", async () => {
    const result = await inspectPdf(bytesSource(makePdf({ info: { Title: "Info Title", Author: "Anna Vale; Ben Moss", CreationDate: "D:19990304120000Z" } }), "info.pdf"));
    try {
      expect(result.metadata).toMatchObject({ title: "Info Title", date: "1999-03-04", authors: [{ name: "Anna Vale" }, { name: "Ben Moss" }] });
      expect(result.manifest.pdf).toEqual({ pages: 2, linearized: false });
    } finally {
      await result.close?.();
    }
  });

  it("prefers XMP: dc:title, dc:creator, prism:isbn and xmp:CreateDate", async () => {
    const xmp = makeXmp({ title: "XMP Title", creators: ["Anna Vale"], isbn: "978-0-306-40615-7", createDate: "2001-02-03T10:00:00Z" });
    const result = await inspectPdf(bytesSource(makePdf({ xmp, info: { Title: "Info Title" } }), "xmp.pdf"));
    try {
      expect(result.metadata).toMatchObject({ title: "XMP Title", authors: [{ name: "Anna Vale" }], date: "2001-02-03" });
      expect(result.metadata.identifiers).toEqual([{ scheme: "isbn", value: "978-0-306-40615-7" }]);
    } finally {
      await result.close?.();
    }
  });

  it("quarantines a PDF that will not parse", async () => {
    const result = await inspectPdf(bytesSource(new TextEncoder().encode("%PDF-1.4\nnot really a pdf at all"), "broken.pdf"));
    expect(result.problem).toMatch(/^Damaged PDF/);
  });
});

describe("CBZ", () => {
  it("reads ComicInfo.xml and orders the pages naturally, the first as the cover", async () => {
    const result = await inspectCbz(bytesSource(await makeCbz(), "comic.cbz"));
    expect(result.metadata).toMatchObject({ title: "Night Harbour", series: "Harbour", seriesIndex: 3, language: "fr", date: "2011-04", authors: [{ name: "Anna Vale" }], description: "Boats at night." });
    expect(result.metadata.identifiers).toEqual([{ scheme: "isbn", value: "9780306406157" }]);
    expect(result.details).toEqual({ pages: 3, comicInfo: true });
    expect(comicPages(["page10.jpg", "page1.jpg", "__MACOSX/page1.jpg", "page2.jpg", "ComicInfo.xml"])).toEqual(["page1.jpg", "page2.jpg", "page10.jpg"]);
    // The first page in that order is the cover: the darkest of the three
    const { dominant } = await sharp(Buffer.from(await result.cover!.load())).stats();
    expect(dominant.r).toBeLessThan(0x40);
    expect(result.text).toEqual({ kind: "none", reason: "Comic book: no text to count" });
  });
});

describe("FB2 and FB2Z", () => {
  it("reads title-info and publish-info, the cover and the text without the notes", async () => {
    const fb2 = makeFb2({ cover: await makeImage("png"), notes: "NOTEWORD ".repeat(20) });
    const result = await inspectFb2(bytesSource(new TextEncoder().encode(fb2), "book.fb2"), "fb2");
    expect(result.metadata).toMatchObject({
      title: "The Letter and the Lamp",
      authors: [{ name: "Anna M. Vale" }],
      language: "en",
      series: "River Books",
      seriesIndex: 2,
      date: "1999-01-01",
      publisher: "River Press",
      description: "A letter, found.\n\nA lamp, lit.",
      identifiers: [{ scheme: "isbn", value: "978-0-306-40615-7" }],
    });
    expect((await result.cover!.load()).subarray(1, 4)).toEqual(new TextEncoder().encode("PNG"));
    expect(result.text?.kind).toBe("plain");
    expect(JSON.stringify(result.text)).not.toContain("NOTEWORD");
  });

  it("reads the same from a zipped FB2Z, with its zip facts", async () => {
    const result = await inspectFb2(bytesSource(makeZip([{ name: "book.fb2", data: makeFb2() }]), "book.fbz"), "fbz");
    expect(result.metadata.title).toBe("The Letter and the Lamp");
    expect(result.manifest.zip).toMatchObject({ entries: 1, opfPath: null });
  });
});
