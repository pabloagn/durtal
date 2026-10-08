import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  encryptionXml,
  makeCbz,
  makeCorruptZip,
  makeDocx,
  makeEpub,
  makeFb2,
  makeImage,
  makeKfx,
  makeMobi,
  makePdf,
  makeSidecarOpf,
  makeZip,
  words,
} from "./ebook-builders";

/*
 * The e-book corpus (SLN-494): one file of every format and case the
 * ingestion handles (a sidecar folder with two formats, Kindle files, a
 * comic, FB2 and FB2Z, a scanned PDF, three kinds of DRM, two damaged files,
 * files that are not e-books and a duplicate), then `count` generated EPUBs
 * of varied length. Built in code, so nothing binary is committed; the
 * timing test and scripts/qa/make-ebook-corpus.ts write it.
 */

const adobe = [
  { name: "META-INF/encryption.xml", data: encryptionXml([{ uri: "OEBPS/c1.xhtml", algorithm: "http://www.w3.org/2001/04/xmlenc#aes128-cbc" }]) },
  { name: "META-INF/rights.xml", data: "<rights/>" },
];

/** A generated EPUB: its own title, author and length, from its number */
function generated(n: number): Uint8Array {
  const length = 400 + ((n * 7919) % 6000);
  return makeEpub({
    metadata: `<dc:title>Generated Book ${n}</dc:title><dc:creator opf:role="aut" opf:file-as="Moss, Ben">Ben Moss</dc:creator><dc:language>en</dc:language><dc:date>${1900 + (n % 120)}</dc:date>`,
    chapters: [
      { id: "c1", href: "c1.xhtml", body: `<h1>One</h1><p>${words(Math.ceil(length / 2), n)}</p>` },
      { id: "c2", href: "c2.xhtml", body: `<h1>Two</h1><p>${words(Math.floor(length / 2), n + 1)}</p>` },
    ],
    salt: `generated-${n}`,
  });
}

/** Writes the corpus under `dir`; returns the paths written, sidecars included */
export async function writeEbookCorpus(dir: string, options: { count?: number } = {}): Promise<string[]> {
  const written: string[] = [];
  const put = (relative: string, bytes: Uint8Array | string) => {
    const file = path.join(dir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    written.push(file);
  };
  const cover = await makeImage("png", { width: 600, height: 900, color: "#556677" });
  const lamp = makeFb2({ title: "The Lamp", cover: await makeImage("png", { width: 300, height: 450, color: "#776655" }) });

  put("Anna Vale/The Letter and the Lamp (1)/metadata.opf", makeSidecarOpf({ title: "The Letter and the Lamp", author: "Anna Vale", fileAs: "Vale, Anna", uuid: "6f1c2b9e-3a4d-4e5f-8a7b-9c0d1e2f3a4b", isbn: "9780306406157", rating: 8, series: "River Books", seriesIndex: 2 }));
  put("Anna Vale/The Letter and the Lamp (1)/The Letter and the Lamp - Anna Vale.epub", makeEpub({ cover, salt: "letter" }));
  put("Anna Vale/The Letter and the Lamp (1)/The Letter and the Lamp - Anna Vale.pdf", makePdf({ info: { Title: "The Letter and the Lamp", Author: "Anna Vale" } }));
  put("Kindle/Night Train.mobi", makeMobi({ title: "Night Train", exth: [[100, "Ben Moss"], [503, "Night Train"], [524, "en"]], cover }));
  put("Kindle/Night Ferry.azw3", makeMobi({ title: "Night Ferry", version: 8, exth: [[100, "Ben Moss"], [503, "Night Ferry"]] }));
  put("Comics/Night Harbour.cbz", await makeCbz());
  put("FB2/The Lamp.fb2", lamp);
  put("FB2/The Lantern.fbz", makeZip([{ name: "The Lantern.fb2", data: makeFb2({ title: "The Lantern", salt: "lantern" }) }]));
  put("PDF/A Scanned Book.pdf", makePdf({ pages: ["", "", ""], info: { Title: "A Scanned Book" } }));
  put("PDF/A Printed Book.pdf", makePdf({ pages: [words(300, 11), words(300, 12), words(300, 13)], info: { Title: "A Printed Book", Author: "Clara Dunn" } }));
  put("DRM/The Locked Room.epub", makeEpub({ entries: adobe, metadata: `<dc:title>The Locked Room</dc:title><dc:creator>Ben Moss</dc:creator><dc:language>en</dc:language>` }));
  put("DRM/A Kindle Book.azw", makeMobi({ title: "A Kindle Book", encryption: 2 }));
  put("DRM/A Password.pdf", makePdf({ encrypt: { user: "secret", owner: "owner" } }));
  put("Damaged/Cut Short.epub", makeCorruptZip());
  put("Damaged/No Spine.epub", makeEpub({ emptySpine: true, salt: "no spine" }));
  put("Not books/photo.png", await makeImage("png", { width: 40, height: 40 }));
  put("Not books/notes.txt", "Plain words, not an e-book.");
  put("Not books/letter.docx", makeDocx());
  put("Not books/archive.zip", makeZip([{ name: "readme.txt", data: "hello" }]));
  put("Kindle/A KFX Book.kfx", makeKfx());
  put("Copies/The Lamp (copy).fb2", lamp);
  for (let n = 1; n <= (options.count ?? 0); n++) put(`Generated/Generated Book ${String(n).padStart(4, "0")}.epub`, generated(n));
  return written;
}
