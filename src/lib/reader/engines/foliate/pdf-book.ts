import type { PageViewport } from "pdfjs-dist";
import type { FoliateBook, FoliateTocEntry } from "./foliate";
import type { PdfSession } from "./pdf-session";
import { PdfRasterRenderer } from "./pdf-raster-renderer";
import { forPdfOwner } from "./pdf-lifetime";
import { pdfGeometryViewport, pdfTextLayerTransform } from "./pdf-viewport";
import { cropEnabled, isScannedPage, type ContentBox } from "./pdf-crop";
import { pdfImageCoverage } from "./pdf-image-coverage";
import { applyPdfPageTheme } from "./pdf-page-theme";
import type { ReaderPresentation } from "@/lib/validations/reader-preferences";

type PdfApi = Pick<typeof import("pdfjs-dist"), "TextLayer" | "OPS">;
export interface PdfFixedPageSource {
  data: string;
  src: string;
  onZoom(input: { doc: Document; scale: number }): Promise<{ width: number; height: number }>;
  onDestroy(doc: Document): void;
}
interface TextFrame {
  owner: AbortController;
  layer?: InstanceType<PdfApi["TextLayer"]>;
}

/** PDF page documents still run through foliate's shared fixed-layout view. */
export async function makePdfBook(
  session: PdfSession,
  api: PdfApi,
  css: string,
  initialPolicy?: ReaderPresentation,
) {
  const pdf = session.document;
  const { parsePDFMetadata } = await import("@/vendor/foliate-js/pdf.js");
  const first = await session.acquirePage(0, session.signal);
  const firstViewport = first.page.getViewport({ scale: 1 });
  first.release();
  const raster = new PdfRasterRenderer(session);
  const frames = new Map<Document, TextFrame>();
  const viewports = new Map<Document, PageViewport>();
  const offsets = new Map<Document, { left: number; top: number }>();
  let policy = initialPolicy;
  let scan: boolean | undefined;
  const crops = new Map<number, ContentBox | null>();
  let sampleQueue: Promise<unknown> = Promise.resolve();
  const cropFor = async (index: number, owner: AbortSignal): Promise<ContentBox | null> => {
    if (!policy || policy.cropMargins === "off") return null;
    const work = sampleQueue.then(async () => {
      owner.throwIfAborted();
      if (scan === undefined) {
        const page = await session.acquirePage(0, owner);
        try {
          const text = await session.pageTextContent(0, owner);
          const operators = await forPdfOwner(page.page.getOperatorList(), owner);
          scan = isScannedPage(pdfImageCoverage(operators.fnArray, operators.argsArray, api.OPS, page.page.view), text.items.some(item => "str" in item && item.str.trim().length > 0));
        } finally { page.release(); }
      }
      if (!policy || !cropEnabled(policy.cropMargins, scan)) return null;
      if (crops.has(index)) { const found = crops.get(index)!; crops.delete(index); crops.set(index, found); return found; }
      const measured = await raster.measureContentBox(index, owner); owner.throwIfAborted(); crops.set(index, measured);
      if (crops.size > 16) crops.delete(crops.keys().next().value!);
      return measured;
    });
    sampleQueue = work.catch(() => {}); return work;
  };
  const closed = new AbortController();
  const signal = AbortSignal.any([closed.signal, session.signal]);
  const release = (doc: Document) => {
    const frame = frames.get(doc);
    frames.delete(doc);
    viewports.delete(doc);
    offsets.delete(doc);
    try {
      frame?.owner.abort();
      frame?.layer?.cancel();
    } finally {
      raster.releaseDocument(doc);
    }
  };
  const pageLabels = await forPdfOwner(pdf.getPageLabels().catch(() => null), signal);
  const metadata = await forPdfOwner(pdf.getMetadata().catch(() => null), signal);
  const preferences = await forPdfOwner(pdf.getViewerPreferences().catch(() => null), signal);
  const direction = preferences?.get("Direction") === "R2L" ? "rtl" : "ltr";
  const info: Record<
    string,
    string | number[] | Uint8Array | null | undefined
  > = {};
  for (const [key, value] of Object.entries(metadata?.info ?? {})) {
    if (
      value == null ||
      typeof value === "string" ||
      value instanceof Uint8Array ||
      (Array.isArray(value) &&
        value.every((number) => typeof number === "number"))
    )
      info[key] = value;
  }
  const destinationIndex = async (
    destination: unknown,
  ): Promise<number | null> => {
    let dest = destination;
    signal.throwIfAborted();
    if (typeof dest === "string") dest = await forPdfOwner(pdf.getDestination(dest), signal);
    if (!Array.isArray(dest) || !dest.length) return null;
    const index =
      typeof dest[0] === "number" ? dest[0] : await forPdfOwner(pdf.getPageIndex(dest[0]), signal);
    return Number.isSafeInteger(index) &&
      index >= 0 &&
      index < session.pageCount
      ? index
      : null;
  };
  const outlineItem = async (
    item: Awaited<ReturnType<typeof pdf.getOutline>> extends (infer T)[] | null
      ? T
      : never,
  ): Promise<FoliateTocEntry> => {
    const index = await destinationIndex(item.dest).catch(() => null);
    return {
      label: item.title?.trim().slice(0, 300) || "Untitled",
      href: index === null ? "" : String(index),
      subitems: await Promise.all(item.items.map(outlineItem)),
    };
  };
  const outline = await forPdfOwner(pdf.getOutline().catch(() => null), signal);
  const book: FoliateBook & {
    rendition: { layout: string; viewport: { width: number; height: number } };
    setTwoPages(twoPages: boolean): void;
    setPdfPresentation(next: ReaderPresentation): boolean;
    pdfCropOffset(doc: Document): { left: number; top: number };
    pdfViewport(doc: Document): ReturnType<typeof pdfGeometryViewport> | null;
  } = {
    metadata: parsePDFMetadata({
      info,
      xmp: metadata?.metadata?.getRaw(),
    }),
    dir: direction,
    rendition: {
      layout: "pre-paginated",
      viewport: { width: firstViewport.width, height: firstViewport.height },
    },
    toc: outline ? await Promise.all(outline.map(outlineItem)) : [],
    pageList: Array.from({ length: session.pageCount }, (_, index) => ({
      label: pageLabels?.[index]?.trim().slice(0, 40) || String(index + 1),
      href: String(index),
    })),
    sections: [],
    resolveHref: async (href) => {
      const index = /^\d+$/.test(href)
        ? Number(href)
        : await destinationIndex(JSON.parse(href)).catch(() => null);
      return index !== null &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < session.pageCount
        ? { index }
        : null;
    },
    splitTOCHref: (href) => [Number(href), null],
    getTOCFragment: (doc) => doc.documentElement,
    isExternal: (href) => /^(https?:|mailto:)/i.test(href),
    setTwoPages: (twoPages) => raster.setTwoPages(twoPages),
    setPdfPresentation: next => { const changed = policy?.cropMargins !== next.cropMargins; policy = next; for (const doc of frames.keys()) applyPdfPageTheme(doc, next); return changed; },
    pdfCropOffset: doc => offsets.get(doc) ?? { left: 0, top: 0 },
    pdfViewport: (doc) => {
      const viewport = viewports.get(doc);
      return viewport ? pdfGeometryViewport(viewport) : null;
    },
    destroy: () => {
      if (closed.signal.aborted) return;
      closed.abort();
      try {
        for (const doc of frames.keys()) release(doc);
        raster.close();
      } finally {
        void session.destroy().catch(() => {});
      }
    },
  };
  book.sections = Array.from({ length: session.pageCount }, (_, index) => ({
    id: index,
    size: 1500,
    pageSpread: index === 0 ? "center" : undefined,
    load: async (): Promise<PdfFixedPageSource> => {
      signal.throwIfAborted();
      const lease = await session.acquirePage(index, signal);
      const viewport = lease.page.getViewport({ scale: 1 });
      lease.release();
      if (viewport.width >= viewport.height)
        book.sections[index].pageSpread = "center";
      const crop = await cropFor(index, signal);
      const pageWidth = viewport.width * ((crop?.right ?? 1) - (crop?.left ?? 0));
      const pageHeight = viewport.height * ((crop?.bottom ?? 1) - (crop?.top ?? 0));
      const data = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${pageWidth}, height=${pageHeight}"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'"><style>html,body{margin:0;padding:0}#canvas{position:absolute;inset:0}${css}</style></head><body><div id="pdf-page" style="position:absolute"><div id="canvas"></div><div class="textLayer"></div><div class="annotationLayer"></div></div></body></html>`;
      return {
        src: "",
        data,
        onDestroy: release,
        onZoom: async ({ doc, scale }) => {
          signal.throwIfAborted();
          viewports.delete(doc);
          offsets.delete(doc);
          const previous = frames.get(doc);
          previous?.owner.abort();
          previous?.layer?.cancel();
          const frame: TextFrame = { owner: new AbortController() };
          frames.set(doc, frame);
          const frameSignal = AbortSignal.any([signal, frame.owner.signal]);
          const crop = await cropFor(index, frameSignal);
          const viewport = await raster.paint(index, doc, scale, frameSignal);
          frameSignal.throwIfAborted();
          doc.documentElement.style.setProperty(
            "--total-scale-factor",
            String(viewport.scale * viewport.userUnit),
          );
          doc.documentElement.style.setProperty(
            "--scale-factor",
            String(viewport.scale),
          );
          doc.documentElement.style.setProperty(
            "--user-unit",
            String(viewport.userUnit),
          );
          doc.documentElement.style.setProperty("--scale-round-x", "1px");
          doc.documentElement.style.setProperty("--scale-round-y", "1px");
          const container = doc.querySelector<HTMLElement>(".textLayer")!;
          container.replaceChildren();
          const content = await session.pageTextContent(index, frameSignal);
          frameSignal.throwIfAborted();
          const layer = new api.TextLayer({
            textContentSource: content,
            container,
            viewport,
          });
          container.style.transform = pdfTextLayerTransform(viewport);
          frame.layer = layer;
          const abort = () => layer.cancel();
          frameSignal.addEventListener("abort", abort, { once: true });
          try {
            await forPdfOwner(Promise.resolve(layer.render()), frameSignal);
          } finally {
            frameSignal.removeEventListener("abort", abort);
          }
          frameSignal.throwIfAborted();
          // Durtal exposes safe link annotations through the common navigation
          // path. PDF JavaScript, forms, launch actions and embedded files do not run.
          const page = await session.acquirePage(index, frameSignal);
          try {
            const annotations = await forPdfOwner(
              page.page.getAnnotations(),
              frameSignal,
            );
            frameSignal.throwIfAborted();
            const links = doc.querySelector<HTMLElement>(".annotationLayer")!;
            links.replaceChildren();
            for (const annotation of annotations) {
              let href: string | undefined;
              if (typeof annotation.url === "string") {
                try {
                  const url = new URL(annotation.url);
                  if (["http:", "https:", "mailto:"].includes(url.protocol))
                    href = url.href;
                } catch {
                  /* Invalid external targets remain inert. */
                }
              } else if (annotation.dest) {
                const target = await forPdfOwner(destinationIndex(annotation.dest).catch(() => null), frameSignal);
                frameSignal.throwIfAborted();
                if (target !== null) href = String(target);
              }
              if (
                !href ||
                !Array.isArray(annotation.rect) ||
                annotation.rect.length !== 4 ||
                !annotation.rect.every(Number.isFinite)
              )
                continue;
              const rect = pdfGeometryViewport(
                viewport,
              ).convertToViewportRectangle(annotation.rect);
              const anchor = doc.createElement("a");
              anchor.setAttribute("href", href);
              anchor.setAttribute(
                "aria-label",
                typeof annotation.title === "string"
                  ? annotation.title.slice(0, 300)
                  : href,
              );
              anchor.style.cssText = `position:absolute;pointer-events:auto;left:${rect[0]}px;top:${rect[1]}px;width:${rect[2] - rect[0]}px;height:${rect[3] - rect[1]}px`;
              if (book.isExternal?.(href)) {
                anchor.target = "_blank";
                anchor.rel = "noopener noreferrer";
              }
              links.append(anchor);
            }
          } finally {
            page.release();
          }
          frameSignal.throwIfAborted();
          const offset = { left: (crop?.left ?? 0) * viewport.width, top: (crop?.top ?? 0) * viewport.height };
          const surface = doc.querySelector<HTMLElement>("#pdf-page")!;
          surface.style.width = `${viewport.width}px`; surface.style.height = `${viewport.height}px`;
          surface.style.transform = `translate(${-offset.left}px, ${-offset.top}px)`;
          const size = { width: viewport.width / scale * ((crop?.right ?? 1)-(crop?.left ?? 0)), height: viewport.height / scale * ((crop?.bottom ?? 1)-(crop?.top ?? 0)) };
          doc.querySelector('meta[name="viewport"]')?.setAttribute("content", `width=${size.width}, height=${size.height}`);
          offsets.set(doc, offset);
          if (policy) applyPdfPageTheme(doc, policy);
          viewports.set(doc, viewport);
          doc.dispatchEvent(new Event("durtal-pdf-painted"));
          return size;
        },
      };
    },
  }));
  return book;
}
