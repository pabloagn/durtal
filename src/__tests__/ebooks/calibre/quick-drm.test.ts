import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { quickDrm } from "@/lib/ebooks/calibre/import-existing";
import { encryptionXml, makeEpub, makeMobi, makePdf } from "../../fixtures/ebook-builders";

/* SLN-657: the dry run's quick DRM look at the books in scope, never the whole file */

const dir = mkdtempSync(path.join(tmpdir(), "durtal-quick-drm-"));
const file = (name: string, bytes: Uint8Array | string) => {
  const full = path.join(dir, name);
  writeFileSync(full, bytes);
  return full;
};

describe("quick DRM look", () => {
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("names Adobe's EPUB DRM and a Kindle book's, and passes obfuscated fonts and plain books", async () => {
    const adobe = makeEpub({
      entries: [
        { name: "META-INF/encryption.xml", data: encryptionXml([{ uri: "OEBPS/c1.xhtml", algorithm: "http://www.w3.org/2001/04/xmlenc#aes128-cbc" }]) },
        { name: "META-INF/rights.xml", data: "<rights/>" },
      ],
    });
    const fonts = makeEpub({ entries: [{ name: "META-INF/encryption.xml", data: encryptionXml([{ uri: "OEBPS/font.otf", algorithm: "http://www.idpf.org/2008/embedding" }]) }] });
    expect(await quickDrm(file("adobe.epub", adobe), "epub")).toBe("adobe-adept");
    expect(await quickDrm(file("fonts.epub", fonts), "epub")).toBeNull();
    expect(await quickDrm(file("plain.epub", makeEpub()), "epub")).toBeNull();
    expect(await quickDrm(file("locked.azw3", makeMobi({ encryption: 2 })), "azw3")).toBe("kindle");
    expect(await quickDrm(file("open.mobi", makeMobi()), "mobi")).toBeNull();
  });

  it("leaves a PDF and a damaged file to the plan", async () => {
    expect(await quickDrm(file("book.pdf", makePdf()), "pdf")).toBeNull();
    expect(await quickDrm(file("broken.epub", "not a zip"), "epub")).toBeNull();
  });
});
