import type { PageViewport } from "pdfjs-dist";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it, vi } from "vitest";
import {
  measurePdfTextLayer,
  pdfTextRuns,
  PdfTextMeasurementQueue,
} from "@/lib/reader/engines/foliate/pdf-text-measure";
import { pdfRectsForTextOffsets } from "@/lib/reader/engines/foliate/pdf-text-geometry";

function content(items: { str: string; hasEOL?: boolean }[]): TextContent {
  return {
    items: items.map(
      (item) => ({ ...item, hasEOL: item.hasEOL ?? false }) as TextItem,
    ),
    styles: {},
    lang: null,
  };
}
const viewport = {
  width: 200,
  height: 300,
  scale: 1,
  userUnit: 1,
  rotation: 0,
  convertToPdfPoint: (x: number, y: number) => [x, 300 - y],
} as PageViewport;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// Deliberate layout double: unequal glyph advances and overlapping fi bounds.
// Native browser/font alignment is a separate gated proof, not this unit test.
function layoutHarness({ empty = false, gates = [] as Promise<void>[] } = {}) {
  const hosts: {
    remove: ReturnType<typeof vi.fn>;
    style: { setProperty: ReturnType<typeof vi.fn> };
  }[] = [];
  const cancel = vi.fn();
  const bounds = { left: 100, top: 200, width: 200, height: 300 };
  const doc = {
    body: { append: vi.fn() },
    defaultView: { setTimeout },
    fonts: { ready: Promise.resolve() },
    createElement: () => {
      const node = {
        style: { cssText: "", setProperty: vi.fn() },
        attachShadow: () => ({ append: vi.fn() }),
        getBoundingClientRect: () => bounds,
        remove: vi.fn(),
      };
      hosts.push(node);
      return node;
    },
    createRange: () => {
      let start = 0,
        end = 0;
      return {
        setStart: (_node: unknown, offset: number) => {
          start = offset;
        },
        setEnd: (_node: unknown, offset: number) => {
          end = offset;
        },
        getClientRects: () => {
          if (empty) return [];
          const advances = [0, 12, 15, 20, 27, 27, 37, 37];
          // Both glyphs within the synthetic ligature yield its measured box.
          const left = start === 4 ? 20 : advances[start];
          const right = end === 4 ? 27 : advances[end];
          return [
            {
              left: bounds.left + left,
              right: bounds.left + right,
              top: bounds.top + 10,
              bottom: bounds.top + 22,
              width: right - left,
              height: 12,
            },
          ];
        },
      };
    },
  } as unknown as Document;
  let created = 0;
  class Layer {
    textDivs: HTMLElement[];
    gate: Promise<void>;
    constructor(input: { textContentSource: ReadableStream | TextContent }) {
      this.gate = gates[created++] ?? Promise.resolve();
      const source = input.textContentSource as TextContent;
      this.textDivs = source.items
        .filter((item) => "str" in item)
        .map(
          (item) =>
            ({
              firstChild: { nodeType: 3, textContent: item.str },
            }) as unknown as HTMLElement,
        );
    }
    render() {
      return this.gate;
    }
    cancel() {
      cancel();
    }
  }
  const input = {
    document: doc,
    content: content([{ str: "Wi fi😀" }]),
    viewport,
    TextLayer: Layer,
    css: ".textLayer {}",
    signal: new AbortController().signal,
  };
  return {
    input,
    hosts,
    cancel,
    get created() {
      return created;
    },
  };
}

describe("owned measured PDF text producer", () => {
  it("publishes one exact UTF-16 text with explicit inter-item separators", () => {
    const source = content([
      { str: "Wi" },
      { str: "fi", hasEOL: true },
      { str: "😀" },
    ]);
    source.items.splice(1, 0, { type: "beginMarkedContent", id: "mc" });
    expect(pdfTextRuns(source)).toEqual({
      text: "Wi fi\n😀",
      runs: [
        { divIndex: 0, start: 0, end: 2 },
        { divIndex: 1, start: 3, end: 5 },
        { divIndex: 2, start: 6, end: 8 },
      ],
      separators: [
        { start: 2, end: 3 },
        { start: 5, end: 6 },
      ],
    });
  });

  it("converts measured unequal glyphs/ligatures and surrogate pairs to PDF units", async () => {
    const h = layoutHarness();
    const measured = await measurePdfTextLayer(h.input);
    expect(measured.text).toBe("Wi fi😀");
    expect(pdfRectsForTextOffsets(measured, 0, 1)).toEqual([[0, 278, 12, 290]]);
    expect(pdfRectsForTextOffsets(measured, 1, 2)).toEqual([
      [12, 278, 15, 290],
    ]);
    expect(pdfRectsForTextOffsets(measured, 3, 5)).toEqual([
      [20, 278, 27, 290],
    ]);
    expect(measured.clusters.at(-1)).toMatchObject({ start: 5, end: 7 });
    expect(h.hosts[0].remove).toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalledOnce();
  });

  it("returns absent geometry for empty DOMRects instead of guessing widths", async () => {
    const h = layoutHarness({ empty: true });
    const measured = await measurePdfTextLayer(h.input);
    expect(measured.clusters).toEqual([]);
    expect(pdfRectsForTextOffsets(measured, 0, 2)).toBeNull();
  });

  it("cancels its own active layer and immediately removes the measurement host", async () => {
    const gate = deferred();
    const h = layoutHarness({ gates: [gate.promise] });
    const owner = new AbortController();
    const task = measurePdfTextLayer({ ...h.input, signal: owner.signal });
    const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
    owner.abort();
    expect(h.hosts[0].remove).toHaveBeenCalled();
    await rejected;
    gate.resolve();
    expect(h.cancel).toHaveBeenCalled();
  });

  it("keeps one active host when a queued owner aborts and later work arrives", async () => {
    const gate = deferred();
    const h = layoutHarness({ gates: [gate.promise] });
    const queue = new PdfTextMeasurementQueue();
    const first = queue.measure(h.input);
    await tick();
    await tick();
    const secondOwner = new AbortController();
    const second = queue.measure({ ...h.input, signal: secondOwner.signal });
    const rejected = expect(second).rejects.toMatchObject({
      name: "AbortError",
    });
    secondOwner.abort();
    await rejected;
    const third = queue.measure(h.input);
    await tick();
    await tick();
    expect(h.created).toBe(1);
    gate.resolve();
    await Promise.all([first, third]);
    expect(h.created).toBe(2);
    queue.close();
    await expect(queue.measure(h.input)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("closes every queued owner and removes the active host", async () => {
    const h = layoutHarness({ gates: [new Promise(() => {})] });
    const queue = new PdfTextMeasurementQueue();
    const first = queue.measure(h.input),
      second = queue.measure(h.input);
    const results = Promise.allSettled([first, second]);
    await tick();
    await tick();
    queue.close();
    expect((await results).every((item) => item.status === "rejected")).toBe(
      true,
    );
    expect(h.hosts[0].remove).toHaveBeenCalled();
  });

  it("requires active layout and a finite valid viewport", async () => {
    const h = layoutHarness();
    await expect(
      measurePdfTextLayer({ ...h.input, document: { body: {} } as Document }),
    ).rejects.toThrow(/active layout/);
    await expect(
      measurePdfTextLayer({
        ...h.input,
        viewport: { ...viewport, width: Infinity } as PageViewport,
      }),
    ).rejects.toThrow(/viewport/);
    expect(h.created).toBe(0);
  });
});
