import path from "node:path";
import { getDocument, PDFDataRangeTransport, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type { ByteSource } from "../source";
import { emptyInspection, type FileAuthor, type Inspection } from "./types";
import { inspectionBudget, retainInspectionText } from "../budget";
import { MiB, UPLOAD_LIMITS } from "../../upload/limits";

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

type NativeCanvas = Canvas;
type CanvasPair = { canvas: NativeCanvas | null; context: ReturnType<NativeCanvas["getContext"]> | null };
/** Covers and pdf.js's intermediate canvases reserve native bytes before resize. */
class BoundedCanvasFactory {
  private reservations = new Map<NativeCanvas, () => void>();
  create(width: number, height: number): CanvasPair {
    const release = inspectionBudget()!.imageAllocation(width, height, width * height * 8 + MiB);
    try {
      const canvas = createCanvas(width, height); this.reservations.set(canvas, release);
      return { canvas, context: canvas.getContext("2d") };
    } catch (error) { release(); throw error; }
  }
  reset(pair: CanvasPair, width: number, height: number): void {
    if (!pair.canvas || !this.reservations.has(pair.canvas)) throw new Error("PDF canvas ownership differs");
    const release = inspectionBudget()!.imageAllocation(width, height, width * height * 8 + MiB);
    // Avoid an intermediate width x old-height surface when resizing.
    pair.canvas.width = 1; pair.canvas.height = 1;
    this.reservations.get(pair.canvas)!();
    pair.canvas.width = width; pair.canvas.height = height; this.reservations.set(pair.canvas, release);
  }
  destroy(pair: CanvasPair): void {
    if (!pair.canvas) throw new Error("PDF canvas is absent");
    pair.canvas.width = 0; pair.canvas.height = 0;
    this.reservations.get(pair.canvas)?.(); this.reservations.delete(pair.canvas);
    pair.canvas = null; pair.context = null;
  }
}

/** pdf.js's own fonts, character maps and image decoders, read from its package folder */
// Use Node's runtime resolver for a filesystem path. A statically analyzed
// require.resolve can become a Turbopack module ID instead of a path string.
const PDFJS = path.dirname(process.getBuiltinModule("module")
  .createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
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
    retainInspectionText(content.items.reduce((total, item) => total + ("str" in item ? item.str.length + 1 : 0), 0) * 2);
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
  const budget = inspectionBudget();
  if (budget) {
    const width = Math.round(viewport.width); const height = Math.round(viewport.height);
    if (width > UPLOAD_LIMITS.coverWidth || height > UPLOAD_LIMITS.coverHeight) budget.reject("PDF cover exceeds its bounded viewport");
    const factory = new BoundedCanvasFactory(); const pair = factory.create(width, height);
    const releaseOutput = budget.imageAllocation(width, height, width * height * 8 + MiB);
    try {
      const context = pair.context!; context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height);
      await page.render({ canvas: pair.canvas as unknown as HTMLCanvasElement, viewport }).promise;
      const bytes = pair.canvas!.toBuffer("image/png");
      if (bytes.length > width * height * 8 + MiB) budget.reject("PDF cover encoding exceeds its native envelope");
      budget.decodedChunk("pdf:cover", bytes.length); budget.imageAllocation(1, 1, bytes.length);
      return bytes;
    } finally { page.cleanup(); factory.destroy(pair); releaseOutput(); }
  }
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
  page.cleanup();
  return canvas.toBuffer("image/png");
}

export async function inspectPdf(source: ByteSource): Promise<Inspection> {
  const budget = inspectionBudget();
  if (budget) {
    // pdf.js's range cache reserves a whole-length backing buffer. Refuse its
    // allocation before getDocument, and account for possible syntax strings.
    budget.decodedChunk("pdf:source", source.size); budget.retainTextPermanent(source.size * 2);
  }
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
    ...(budget ? { CanvasFactory: BoundedCanvasFactory, maxImageSize: UPLOAD_LIMITS.imagePixels,
      canvasMaxAreaInBytes: UPLOAD_LIMITS.nativeImageBytes, isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false, useWasm: false, isEvalSupported: false, stopAtErrors: true } : {}),
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
    const texts = budget ? await budget.pdfText(() => pageTexts(doc), budget.signal) : await pageTexts(doc);
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
