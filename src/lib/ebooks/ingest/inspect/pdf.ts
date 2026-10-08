import { createRequire } from "node:module";
import path from "node:path";
import { getDocument, PDFDataRangeTransport, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import type { ByteSource } from "../source";
import { emptyInspection, type FileAuthor, type Inspection } from "./types";

/*
 * PDFs with pdf.js's legacy build in Node (SLN-494), read in chunks through
 * a range transport, never whole: the info dictionary and XMP, the page
 * count, whether it is linearized, the text of every page (at most 60
 * seconds a file), and the first page rendered as the cover. A PDF that
 * opens with an empty user password is readable (an owner password only
 * restricts printing); one that needs a password is `pdf-password`, and
 * Adobe's EBX_HANDLER filter is `adobe-adept`.
 */

const CHUNK = 256 * 1024;
const TEXT_LIMIT_MS = 60_000;
const COVER_WIDTH = 800;

/** pdf.js's own fonts, character maps and image decoders, read from its package folder */
const PDFJS = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const PDFJS_FILES = {
  standardFontDataUrl: `${PDFJS}/standard_fonts/`,
  cMapUrl: `${PDFJS}/cmaps/`,
  cMapPacked: true,
  wasmUrl: `${PDFJS}/wasm/`,
  iccUrl: `${PDFJS}/iccs/`,
};

/**
 * pdf.js takes ownership of the bytes it is handed and detaches their buffer,
 * which may be shared (Node's small-Buffer pool, or a file held in memory):
 * it always gets its own copy.
 */
class SourceTransport extends PDFDataRangeTransport {
  private readonly source: ByteSource;
  constructor(source: ByteSource, initial: Uint8Array) {
    super(source.size, new Uint8Array(initial));
    this.source = source;
  }
  requestDataRange(begin: number, end: number) {
    this.source.read(begin, end - begin).then(
      (chunk) => this.onDataRange(begin, new Uint8Array(chunk)),
      () => this.abort(),
    );
  }
}

/** Whether `needle` occurs in the file: read in chunks, with an overlap for a match across two */
async function contains(source: ByteSource, needle: string): Promise<boolean> {
  const bytes = Buffer.from(needle, "latin1");
  for (let at = 0; at < source.size; at += CHUNK) {
    const chunk = Buffer.from(await source.read(at, CHUNK + bytes.length));
    if (chunk.includes(bytes)) return true;
  }
  return false;
}

/** "D:20010101120000+01'00'" or an XMP date: the date part, "2001-01-01" */
function pdfDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = /^D:(\d{4})(\d{2})?(\d{2})?/.exec(value.trim());
  if (d) return [d[1], d[2], d[3]].filter(Boolean).join("-");
  const iso = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(value.trim());
  return iso ? [iso[1], iso[2], iso[3]].filter(Boolean).join("-") : value.trim();
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter((v): v is string => !!v) : str(value) ? [str(value)!] : [];

async function pageTexts(doc: PDFDocumentProxy): Promise<string[] | "timeout"> {
  const deadline = Date.now() + TEXT_LIMIT_MS;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (Date.now() > deadline) return "timeout";
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""));
    page.cleanup();
  }
  return pages;
}

/** The first page as a PNG, 800 px wide */
async function renderFirstPage(doc: PDFDocumentProxy): Promise<Uint8Array> {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
  page.cleanup();
  return canvas.toBuffer("image/png");
}

export async function inspectPdf(source: ByteSource): Promise<Inspection> {
  const head = await source.read(0, Math.min(source.size, CHUNK));
  const linearized = /\/Linearized\b/.test(Buffer.from(head.subarray(0, 1024)).toString("latin1"));
  const task = getDocument({
    range: new SourceTransport(source, head),
    rangeChunkSize: CHUNK,
    disableAutoFetch: true,
    disableStream: true,
    useSystemFonts: false,
    ...PDFJS_FILES,
    verbosity: 0,
    password: "",
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    const name = (error as { name?: string }).name;
    if (name === "PasswordException") return emptyInspection("pdf", { drm: "pdf-password" });
    if (await contains(source, "EBX_HANDLER")) return emptyInspection("pdf", { drm: "adobe-adept" });
    return emptyInspection("pdf", { problem: `Damaged PDF: ${(error as Error).message || "it cannot be opened"}` });
  }

  const close = async () => {
    await task.destroy().catch(() => {});
  };
  try {
    const { info, metadata } = (await doc.getMetadata()) as { info: Record<string, unknown>; metadata: { get(name: string): unknown } | null };
    const xmp = (name: string) => metadata?.get(name) ?? null;
    const creators = list(xmp("dc:creator"));
    const authorText = creators.length ? creators : (str(info.Author) ?? "").split(/\s*[;&]\s*|\s+and\s+/).filter(Boolean);
    const isbn = str(xmp("prism:isbn")) ?? str(xmp("pdfx:isbn"));
    const texts = await pageTexts(doc);
    return emptyInspection("pdf", {
      metadata: {
        title: str(xmp("dc:title")) ?? str(info.Title),
        authors: authorText.map((name): FileAuthor => ({ name, role: "aut" })),
        description: str(xmp("dc:description")) ?? str(info.Subject),
        subjects: list(xmp("dc:subject")),
        publisher: str(xmp("dc:publisher")),
        language: str(xmp("dc:language")),
        date: pdfDate(xmp("xmp:createdate")) ?? pdfDate(xmp("xmp:CreateDate")) ?? pdfDate(info.CreationDate),
        identifiers: isbn ? [{ scheme: "isbn", value: isbn }] : [],
      },
      cover: { kind: "bytes", mediaType: "image/png", load: () => renderFirstPage(doc) },
      manifest: { pdf: { pages: doc.numPages, linearized } },
      text: texts === "timeout" ? { kind: "none", reason: "The PDF's text took longer than 60 seconds to read" } : { kind: "pages", pages: texts },
      details: { pages: doc.numPages, linearized, encrypted: !!info.IsEncrypted || undefined },
      close,
    });
  } catch (error) {
    await close();
    return emptyInspection("pdf", { problem: `Damaged PDF: ${(error as Error).message || "it cannot be read"}` });
  }
}
