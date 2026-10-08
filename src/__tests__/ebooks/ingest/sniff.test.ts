import { describe, expect, it } from "vitest";
import { sniffSource } from "@/lib/ebooks/ingest/prepare";
import { bytesSource } from "@/lib/ebooks/ingest/source";
import { makeCbz, makeCorruptZip, makeDocx, makeEpub, makeFb2, makeImage, makeKfx, makeMobi, makePdf, makeTopaz, makeZip } from "../../fixtures/ebook-builders";

/* SLN-494: what a file is, by its bytes; the name only breaks ties */

const sniff = async (bytes: Uint8Array | string, name: string) => sniffSource(bytesSource(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, name));
const format = async (bytes: Uint8Array | string, name: string) => {
  const result = await sniff(bytes, name);
  return result.kind === "ebook" ? result.format : result.reason;
};

describe("sniffFormat", () => {
  it("knows every built format by its magic bytes", async () => {
    expect(await format(makeEpub(), "book.epub")).toBe("epub");
    expect(await format(makeEpub(), "book.kepub.epub")).toBe("kepub");
    expect(await format(makePdf(), "book.pdf")).toBe("pdf");
    expect(await format(makeMobi(), "book.mobi")).toBe("mobi");
    expect(await format(makeMobi(), "book.azw")).toBe("azw");
    expect(await format(makeMobi({ version: 8 }), "book.mobi")).toBe("azw3");
    expect(await format(makeFb2(), "book.fb2")).toBe("fb2");
    expect(await format(makeZip([{ name: "book.fb2", data: makeFb2() }]), "book.fbz")).toBe("fbz");
    expect(await format(await makeCbz(), "comic.cbz")).toBe("cbz");
    expect(await format("{\\rtf1\\ansi Hello}", "letter.rtf")).toBe("rtf");
    expect(await format("Plain words, in UTF-8: café.", "notes.txt")).toBe("txt");
  });

  it("goes by the bytes, not the name: a PDF named .epub is a PDF", async () => {
    expect(await format(makePdf(), "misnamed.epub")).toBe("pdf");
    expect(await format(makeEpub(), "misnamed.pdf")).toBe("epub");
  });

  it("tells a DOCX, an image-only zip (CBZ) and a plain zip apart", async () => {
    expect(await format(makeDocx(), "letter.docx")).toBe("docx");
    expect(await format(await makeCbz({ comicInfo: false }), "pages.zip")).toBe("cbz");
    expect(await format(makeZip([{ name: "readme.txt", data: "hello" }, { name: "data.csv", data: "a,b" }]), "archive.zip")).toBe("Not an e-book (zip archive)");
  });

  it("knows KFX and Topaz", async () => {
    expect(await format(makeKfx(), "book.kfx")).toBe("kfx");
    expect(await format(new Uint8Array(Buffer.concat([Buffer.from("\xEADRMION", "latin1"), Buffer.alloc(64)])), "book.kfx")).toBe("kfx");
    expect(await format(makeTopaz(), "book.azw1")).toBe("azw");
  });

  it("names what is not an e-book", async () => {
    expect(await format(await makeImage("jpeg"), "cover.jpeg")).toBe("Not an e-book (JPEG image)");
    expect(await format(await makeImage("png"), "scan.png")).toBe("Not an e-book (PNG image)");
    expect(await format(new Uint8Array([0, 1, 2, 3, 0xff, 0xfe, 0, 9]), "blob.bin")).toBe("Not an e-book (binary file)");
    expect(await format(new Uint8Array(0), "empty.epub")).toBe("Empty file");
  });

  it("calls a zip with no central directory a zip, not an EPUB, unless its mimetype says so", async () => {
    // The stored mimetype entry comes first, so a cut-off EPUB is still an EPUB (and quarantined later)
    expect(await format(makeCorruptZip(), "cut.epub")).toBe("epub");
  });
});
