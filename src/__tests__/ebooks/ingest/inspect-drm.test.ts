import { describe, expect, it } from "vitest";
import { inspectEpub } from "@/lib/ebooks/ingest/inspect/epub";
import { inspectMobi } from "@/lib/ebooks/ingest/inspect/mobi";
import { inspectPdf } from "@/lib/ebooks/ingest/inspect/pdf";
import { bytesSource } from "@/lib/ebooks/ingest/source";
import { encryptionXml, makeEpub, makeMobi, makePdf } from "../../fixtures/ebook-builders";

/* SLN-494: DRM is named, never opened; font obfuscation is not DRM */

const epubDrm = async (entries: { name: string; data: string }[]) => (await inspectEpub(bytesSource(makeEpub({ entries }), "book.epub"), "epub")).drm;
const encrypted = (algorithm: string) => ({ name: "META-INF/encryption.xml", data: encryptionXml([{ uri: "OEBPS/c1.xhtml", algorithm }]) });

describe("EPUB DRM", () => {
  it("font obfuscation is not DRM", async () => {
    const fonts = encryptionXml([
      { uri: "OEBPS/fonts/a.otf", algorithm: "http://www.idpf.org/2008/embedding" },
      { uri: "OEBPS/fonts/b.otf", algorithm: "http://ns.adobe.com/pdf/enc#RC" },
    ]);
    const result = await inspectEpub(bytesSource(makeEpub({ entries: [{ name: "META-INF/encryption.xml", data: fonts }] }), "book.epub"), "epub");
    expect(result.drm).toBeNull();
    expect(result.text).not.toBeNull();
  });

  it("detects Adobe, LCP, FairPlay and an unknown scheme", async () => {
    const aes = "http://www.w3.org/2001/04/xmlenc#aes128-cbc";
    expect(await epubDrm([encrypted(aes), { name: "META-INF/rights.xml", data: "<rights/>" }])).toBe("adobe-adept");
    expect(await epubDrm([encrypted(aes), { name: "META-INF/license.lcpl", data: "{}" }])).toBe("readium-lcp");
    expect(await epubDrm([encrypted(aes), { name: "META-INF/sinf.xml", data: "<sinf/>" }])).toBe("apple-fairplay");
    expect(await epubDrm([encrypted(aes)])).toBe("unknown");
  });

  it("reads a DRM file's metadata, and never its text or cover", async () => {
    const result = await inspectEpub(bytesSource(makeEpub({ entries: [encrypted("http://www.w3.org/2001/04/xmlenc#aes256-cbc"), { name: "META-INF/rights.xml", data: "<rights/>" }] }), "book.epub"), "epub");
    expect(result).toMatchObject({ drm: "adobe-adept", problem: null, text: null, cover: null, metadata: { title: "The House by the River" } });
  });
});

describe("Kindle and PDF DRM", () => {
  it("a MOBI whose header names encryption 2 is kindle", async () => {
    const result = await inspectMobi(bytesSource(makeMobi({ encryption: 2, exth: [[100, "Anna Vale"]] }), "book.azw"), "azw");
    expect(result).toMatchObject({ drm: "kindle", text: null, metadata: { authors: [{ name: "Anna Vale", role: "aut" }] } });
  });

  it("an owner password only restricts: the PDF is readable", async () => {
    const result = await inspectPdf(bytesSource(makePdf({ encrypt: { user: "", owner: "secret" } }), "book.pdf"));
    try {
      expect(result.drm).toBeNull();
      expect(result.problem).toBeNull();
      expect(result.manifest.pdf?.pages).toBe(2);
    } finally {
      await result.close?.();
    }
  });

  it("a user password is pdf-password, and Adobe's EBX_HANDLER is adobe-adept", async () => {
    expect((await inspectPdf(bytesSource(makePdf({ encrypt: { user: "reader", owner: "secret" } }), "locked.pdf"))).drm).toBe("pdf-password");
    expect((await inspectPdf(bytesSource(makePdf({ adobe: true }), "adept.pdf"))).drm).toBe("adobe-adept");
  });
});
