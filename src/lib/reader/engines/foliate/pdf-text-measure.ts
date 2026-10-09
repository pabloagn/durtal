import type { PageViewport, TextLayer } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import type { PdfPageTextGeometry, PdfTextCluster } from "./pdf-text-geometry";
import { forPdfOwner } from "./pdf-lifetime";

export interface PdfTextRun {
  divIndex: number;
  start: number;
  end: number;
}

/** Stable UTF-16 text shared by pageText, search and speech offset requests. */
export function pdfTextRuns(content: TextContent) {
  const items = content.items.filter((item) => "str" in item);
  let text = "";
  const runs: PdfTextRun[] = [];
  const separators: { start: number; end: number }[] = [];
  items.forEach((item, divIndex) => {
    const start = text.length;
    text += item.str;
    runs.push({ divIndex, start, end: text.length });
    const separator = item.hasEOL
      ? "\n"
      : divIndex < items.length - 1
        ? " "
        : "";
    if (separator) {
      separators.push({ start: text.length, end: text.length + 1 });
      text += separator;
    }
  });
  return { text, runs, separators };
}

interface MeasuredTextLayer {
  render(): Promise<unknown>;
  cancel(): void;
  readonly textDivs: HTMLElement[];
}
type TextLayerConstructor = new (
  options: ConstructorParameters<typeof TextLayer>[0],
) => MeasuredTextLayer;

/** DOM ranges measure browser glyph/ligature layout; no item-width subdivision. */
export async function measurePdfTextLayer(input: {
  document: Document;
  content: TextContent;
  viewport: PageViewport;
  TextLayer: TextLayerConstructor;
  css: string;
  signal: AbortSignal;
}): Promise<PdfPageTextGeometry> {
  const { document: doc, content, viewport, signal } = input;
  signal.throwIfAborted();
  if (
    ![viewport.width, viewport.height, viewport.scale, viewport.userUnit].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new RangeError("Invalid PDF text measurement viewport");
  const source = pdfTextRuns(content);
  if (!source.text.length) return { text: "", clusters: [], separators: [] };
  if (!doc.body || !doc.defaultView)
    throw new Error(
      "PDF text measurement requires a document with active layout",
    );
  const host = doc.createElement("div");
  host.style.cssText =
    `position:fixed;left:-100000px;top:0;width:${viewport.width}px;` +
    `height:${viewport.height}px;visibility:hidden;pointer-events:none;` +
    "contain:layout style;overflow:hidden;transform:none;zoom:1;";
  host.style.setProperty(
    "--total-scale-factor",
    String(viewport.scale * viewport.userUnit),
  );
  host.style.setProperty("--scale-factor", String(viewport.scale));
  host.style.setProperty("--user-unit", String(viewport.userUnit));
  host.style.setProperty("--scale-round-x", "1px");
  host.style.setProperty("--scale-round-y", "1px");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = input.css;
  const container = doc.createElement("div");
  container.className = "textLayer";
  shadow.append(style, container);
  doc.body.append(host);
  let layer: MeasuredTextLayer | undefined;
  const abort = () => {
    try {
      layer?.cancel();
    } finally {
      host.remove();
    }
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    layer = new input.TextLayer({
      textContentSource: content,
      container,
      viewport,
    });
    await forPdfOwner(Promise.resolve(layer.render()), signal);
    await forPdfOwner(doc.fonts.ready, signal);
    signal.throwIfAborted();
    const bounds = host.getBoundingClientRect();
    const scaleX = bounds.width / viewport.width;
    const scaleY = bounds.height / viewport.height;
    if (!(scaleX > 0 && scaleY > 0) || ![scaleX, scaleY].every(Number.isFinite))
      return { text: source.text, clusters: [], separators: source.separators };
    const clusters: PdfTextCluster[] = [];
    const separators = [...source.separators];
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    let measured = 0;
    for (const run of source.runs) {
      const div = layer.textDivs[run.divIndex];
      const value = source.text.slice(run.start, run.end);
      if (!value) continue;
      const node = div?.firstChild;
      if (!node || node.nodeType !== 3 || node.textContent !== value) continue;
      for (const { segment, index } of segmenter.segment(value)) {
        signal.throwIfAborted();
        const range = doc.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + segment.length);
        const start = run.start + index;
        const end = start + segment.length;
        const rects = [...range.getClientRects()].filter(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            [rect.left, rect.top, rect.right, rect.bottom].every(
              Number.isFinite,
            ),
        );
        if (!rects.length && /^\s+$/.test(segment))
          separators.push({ start, end });
        for (const rect of rects) {
          const points = [
            [rect.left, rect.top],
            [rect.right, rect.top],
            [rect.right, rect.bottom],
            [rect.left, rect.bottom],
          ].flatMap(([x, y]) =>
            viewport.convertToPdfPoint(
              (x - bounds.left) / scaleX,
              (y - bounds.top) / scaleY,
            ),
          );
          if (points.length === 8 && points.every(Number.isFinite))
            clusters.push({
              start,
              end,
              quad: [
                points[0],
                points[1],
                points[2],
                points[3],
                points[4],
                points[5],
                points[6],
                points[7],
              ],
            });
        }
        // A page with many glyphs must yield to cancellation/user input.
        if (++measured % 128 === 0)
          await forPdfOwner(
            new Promise<void>((resolve) =>
              doc.defaultView!.setTimeout(resolve, 0),
            ),
            signal,
          );
      }
    }
    signal.throwIfAborted();
    return { text: source.text, clusters, separators };
  } finally {
    signal.removeEventListener("abort", abort);
    try {
      layer?.cancel();
    } finally {
      host.remove();
    }
  }
}

/** One owned measurement host at a time, separate from visible rendering. */
export class PdfTextMeasurementQueue {
  #tail: Promise<unknown> = Promise.resolve();
  #closed = new AbortController();

  measure(
    input: Omit<Parameters<typeof measurePdfTextLayer>[0], "signal"> & {
      signal: AbortSignal;
    },
  ) {
    const signal = AbortSignal.any([input.signal, this.#closed.signal]);
    const previous = this.#tail;
    // The serial tail follows the producer, not the caller's delivery lease.
    // A cancelled queued caller must never let later work overtake an active host.
    const task = previous.then(() => {
      signal.throwIfAborted();
      return measurePdfTextLayer({ ...input, signal });
    });
    this.#tail = task.catch(() => {});
    return forPdfOwner(task, signal);
  }

  close() {
    this.#closed.abort();
  }
}
