import { describe, expect, it } from "vitest";
import { inspectEpub } from "@/lib/ebooks/ingest/inspect/epub";
import { inspectPdf } from "@/lib/ebooks/ingest/inspect/pdf";
import { bytesSource } from "@/lib/ebooks/ingest/source";
import { countWords, extractBodyText, htmlText } from "@/lib/ebooks/text/extract";
import { detectLanguage } from "@/lib/ebooks/text/language";
import { makeEpub, makePdf } from "../../fixtures/ebook-builders";

/* SLN-494: the body text and its counts */

const epubText = async (bytes: Uint8Array) => {
  const inspection = await inspectEpub(bytesSource(bytes, "book.epub"), "epub");
  return extractBodyText(inspection.text!, inspection.metadata.language);
};

describe("extractBodyText", () => {
  it("counts the built EPUB's body and its front and back matter", async () => {
    // Body: "One" and 400 words, "Two" and 600; front and back: the copyright page (30) and the linear="no" notes (50)
    const counts = await epubText(makeEpub());
    expect(counts).toMatchObject({ wordCount: 1002, frontBackWordCount: 80, pageEstimate: 5, language: "en", toolVersion: 1, reason: null });
    expect(counts.charCount).toBeGreaterThan(4000);
  });

  it("takes a print page list over the estimate", async () => {
    const navExtra = `<nav epub:type="page-list"><ol>${Array.from({ length: 12 }, (_, i) => `<li><a href="c1.xhtml#p${i}">${i + 1}</a></li>`).join("")}</ol></nav>`;
    expect((await epubText(makeEpub({ navExtra }))).pageEstimate).toBe(12);
  });

  it("does not count ruby annotations, scripts, styles or hidden text", () => {
    const html = `<html><head><title>Not this</title><style>p{}</style></head><body><p><ruby>漢<rt>かん</rt></ruby>字</p><script>var a = "no";</script><p hidden="">hidden words</p><p style="display:none">gone</p><p>seen</p></body></html>`;
    expect(htmlText(html)).toBe("漢字\nseen");
  });

  it("counts Japanese with Intl.Segmenter, not by spaces", async () => {
    const japanese = "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。";
    expect(japanese.split(/\s+/)).toHaveLength(1);
    expect(countWords(japanese, "ja")).toBeGreaterThan(10);
    const bytes = makeEpub({ metadata: `<dc:title>猫</dc:title><dc:language>ja</dc:language>`, chapters: [{ id: "c1", href: "c1.xhtml", body: `<p>${japanese}</p>` }] });
    const counts = await epubText(bytes);
    expect(counts.language).toBe("ja");
    expect(counts.wordCount).toBe(countWords(japanese, "ja"));
  });

  it("tells English, Spanish and French apart, and keeps the declared language when it cannot", () => {
    const en = "It was the best of times and it was the worst of times, the age of wisdom and the age of foolishness, the epoch of belief and the epoch of incredulity, the season of light and the season of darkness, the spring of hope and the winter of despair, and we had everything before us, we had nothing before us, we were all going direct to heaven.";
    const es = "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor. Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lentejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda.";
    const fr = "Longtemps, je me suis couché de bonne heure. Parfois, à peine ma bougie éteinte, mes yeux se fermaient si vite que je n'avais pas le temps de me dire que je m'endors. Et, une demi-heure après, la pensée qu'il était temps de chercher le sommeil m'éveillait; je voulais poser le volume que je croyais avoir dans les mains et souffler ma lumière; je n'avais pas cessé en dormant de faire des réflexions sur ce que je venais de lire.";
    expect(detectLanguage(en)).toBe("en");
    expect(detectLanguage(es)).toBe("es");
    expect(detectLanguage(fr)).toBe("fr");
    expect(detectLanguage("Too short to tell")).toBeNull();
    expect(extractBodyText({ kind: "plain", text: "Kurz." }, "de").language).toBe("de");
  });

  it("gives a scanned PDF null counts with the reason", async () => {
    const inspection = await inspectPdf(bytesSource(makePdf({ pages: ["", ""] }), "scan.pdf"));
    try {
      const counts = extractBodyText(inspection.text!, null);
      expect(counts).toMatchObject({ wordCount: null, charCount: null, frontBackWordCount: null, pageEstimate: null, reason: "Scanned PDF: fewer than 20 words a page" });
    } finally {
      await inspection.close?.();
    }
  });

  it("counts a text PDF page by page, its pages as the estimate", async () => {
    const inspection = await inspectPdf(bytesSource(makePdf(), "text.pdf"));
    try {
      expect(extractBodyText(inspection.text!, null)).toMatchObject({ wordCount: 240, pageEstimate: 2, language: "en" });
    } finally {
      await inspection.close?.();
    }
  });
});
