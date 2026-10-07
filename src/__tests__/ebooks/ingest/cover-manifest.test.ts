import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makeCovers } from "@/lib/ebooks/ingest/cover";
import { inspectFile } from "@/lib/ebooks/ingest/inspect";
import { makeManifest } from "@/lib/ebooks/ingest/manifest";
import { readCentralDirectory } from "@/lib/ebooks/ingest/zip";
import { bytesSource } from "@/lib/ebooks/ingest/source";
import type { EbookFormat } from "@/lib/ebooks/formats";
import { makeCbz, makeEpub, makeFb2, makeImage, makeMobi, makePdf, makeZip } from "../../fixtures/ebook-builders";

/* SLN-494: three WebP covers from every format that has one; the manifest's zip facts */

const books = async (): Promise<[EbookFormat, Uint8Array][]> => {
  const png = await makeImage("png");
  return [
    ["epub", makeEpub({ cover: png })],
    ["azw3", makeMobi({ version: 8, cover: await makeImage("jpeg") })],
    ["fb2", new TextEncoder().encode(makeFb2({ cover: png }))],
    ["cbz", await makeCbz()],
    ["pdf", makePdf()],
  ];
};

describe("makeCovers", () => {
  it("writes cover-240, -400 and -800 as WebP from each format", async () => {
    for (const [format, bytes] of await books()) {
      const inspection = await inspectFile(bytesSource(bytes, `book.${format}`), format);
      try {
        const { covers, reason } = await makeCovers(inspection.cover);
        expect(reason, format).toBeNull();
        expect(Object.keys(covers!).sort(), format).toEqual(["cover-240.webp", "cover-400.webp", "cover-800.webp"]);
        for (const [name, webp] of Object.entries(covers!)) {
          const meta = await sharp(Buffer.from(webp)).metadata();
          expect(meta.format, `${format} ${name}`).toBe("webp");
          // Widths, never enlarged: a 300 px cover stays 300 px in the 400 and 800 sizes
          expect(meta.width!, `${format} ${name}`).toBeLessThanOrEqual(Number(/\d+/.exec(name)![0]));
          expect(meta.exif, `${format} ${name}`).toBeUndefined();
        }
      } finally {
        await inspection.close?.();
      }
    }
  }, 60_000);

  it("writes none when there is no cover, and says why", async () => {
    expect(await makeCovers(null)).toEqual({ covers: null, reason: "No cover in the file" });
  });
});

describe("makeManifest", () => {
  it("points zip.cdOffset at the central directory the end record names, on every zip format", async () => {
    const zips: [EbookFormat, Uint8Array][] = [
      ["epub", makeEpub()],
      ["cbz", await makeCbz()],
      ["fbz", makeZip([{ name: "book.fb2", data: makeFb2() }])],
    ];
    for (const [format, bytes] of zips) {
      const inspection = await inspectFile(bytesSource(bytes, `book.${format}`), format);
      const manifest = makeManifest({ sha256: "a".repeat(64), format, size: bytes.length }, inspection.manifest);
      const directory = await readCentralDirectory(bytesSource(bytes, "x"));
      expect(manifest.zip, format).toMatchObject({ cdOffset: directory!.cdOffset, cdSize: directory!.cdSize });
      // The offset holds a central directory entry's signature
      expect(Buffer.from(bytes.subarray(manifest.zip!.cdOffset, manifest.zip!.cdOffset + 4)).readUInt32LE(0), format).toBe(0x02014b50);
      expect(manifest).toMatchObject({ v: 1, format, size: bytes.length });
    }
  });

  it("records an EPUB's version, layout, direction and page list, and a PDF's pages", async () => {
    const epub = await inspectFile(bytesSource(makeEpub(), "b.epub"), "epub");
    expect(makeManifest({ sha256: "b".repeat(64), format: "epub", size: 1 }, epub.manifest)).toMatchObject({
      zip: { opfPath: "OEBPS/content.opf" },
      epub: { version: "3.0", fixedLayout: false, direction: "default", hasPageList: false },
    });
    const pdf = await inspectFile(bytesSource(makePdf(), "b.pdf"), "pdf");
    try {
      expect(makeManifest({ sha256: "c".repeat(64), format: "pdf", size: 1 }, pdf.manifest).pdf).toEqual({ pages: 2, linearized: false });
    } finally {
      await pdf.close?.();
    }
  });
});
