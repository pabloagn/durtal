import type { Decoration, DecorationStyle } from "@/lib/reader/engine";
import { DecorationsIndex } from "@/lib/reader/decorations-index";
import type { FoliateView, FoliateOverlayer } from "./foliate";
import { normalizeQuoteText } from "./quote-match";

interface Mark {
  id: string;
  sectionIndex: number;
  signature: string;
  cfi: string;
  color: string;
  style: DecorationStyle;
  quote?: string;
  note: boolean;
}
interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
type Draw = (rects: Rect[], options?: Record<string, unknown>) => SVGElement;
export interface DecorationDrawing {
  highlight: Draw;
  underline: Draw;
  outline: Draw;
}
const svg = (name: string) =>
  document.createElementNS("http://www.w3.org/2000/svg", name);

/** A small margin glyph uses the last line's edge. Never fills an approximate
 * anchor. Draw functions receive fresh rect arrays on every vendor reflow. */
function margin(rects: Rect[], color: string) {
  const g = svg("g");
  const last = rects.at(-1);
  if (!last) return g;
  const path = svg("path");
  path.setAttribute(
    "d",
    `M ${last.right + 4} ${last.top} v 8 l 3 -2 l 3 2 v -8 z`,
  );
  path.setAttribute("fill", color);
  g.append(path);
  return g;
}
function drawMark(
  drawing: DecorationDrawing,
  mark: Mark,
  writingMode: string,
): Draw {
  return (rects) => {
    const g = svg("g");
    const options = { color: mark.color, width: 2, writingMode };
    if (mark.style === "highlight") {
      const fill = drawing.highlight(rects, { ...options, opacity: 0.24 });
      // The vendored fill uses a theme CSS variable; an explicit opacity owns
      // this group's palette without changing search or history drawing.
      fill.style.opacity = "0.24";
      g.append(fill);
    } else if (mark.style === "quote") {
      g.append(drawing.underline(rects, { ...options, width: 1, padding: 0 }));
      g.append(drawing.underline(rects, { ...options, width: 1, padding: 3 }));
    } else if (mark.style === "margin") g.append(margin(rects, mark.color));
    else g.append(drawing[mark.style](rects, options));
    if (mark.note && mark.style !== "margin")
      g.append(margin(rects, mark.color));
    return g;
  };
}

export class FoliateDecorations {
  #index = new DecorationsIndex<Mark>();
  #drawn = new Map<
    FoliateOverlayer,
    Map<string, { signature: string; group: string; item: Mark }>
  >();
  constructor(private drawing: DecorationDrawing) {}
  set(
    view: FoliateView,
    hash: string,
    group: string,
    items: readonly Decoration[],
  ) {
    const marks: Mark[] = [];
    for (const item of items) {
      const legacy = "cfi" in item;
      if (!legacy && item.locator.fileHash !== hash) continue;
      const cfi = legacy ? item.cfi : item.locator.cfi;
      if (!cfi) continue;
      let target;
      try {
        target = view.resolveNavigation(cfi);
      } catch {
        continue;
      }
      if (!target || !Number.isSafeInteger(target.index) || target.index < 0)
        continue;
      const mark: Mark = {
        id: legacy ? cfi : item.id,
        sectionIndex: target.index,
        signature: JSON.stringify(item),
        cfi,
        color: item.color,
        style: legacy ? "outline" : item.style,
        quote: legacy ? undefined : item.locator.text?.highlight,
        note: !legacy && !!item.note,
      };
      marks.push(mark);
    }
    const changed = this.#index.set(group, marks);
    this.render(view, changed);
  }
  render(view: FoliateView, only?: ReadonlySet<number>) {
    const contents = view.renderer.getContents();
    const live = new Set(
      contents.flatMap((content) =>
        content.overlayer ? [content.overlayer] : [],
      ),
    );
    for (const overlayer of this.#drawn.keys())
      if (!live.has(overlayer)) this.#drawn.delete(overlayer);
    for (const { doc, index, overlayer } of contents) {
      if (!overlayer || (only && !only.has(index))) continue;
      const desired = this.#index.section(index);
      const drawn = this.#drawn.get(overlayer) ?? new Map();
      this.#drawn.set(overlayer, drawn);
      for (const [key, previous] of drawn) {
        if (desired.get(key)?.item.signature === previous.signature) continue;
        overlayer.remove(key);
        drawn.delete(key);
      }
      for (const [key, { group, item }] of desired) {
        if (drawn.has(key)) continue;
        try {
          const target = view.resolveNavigation(item.cfi);
          const range = target?.anchor?.(doc);
          if (
            !range ||
            !("startContainer" in range) ||
            range.startContainer.ownerDocument !== doc ||
            !range.startContainer.isConnected
          )
            continue;
          // A CFI is not evidence for a filled range on its own. Verify the
          // entire stored passage in the current document before drawing it.
          if (
            ["highlight", "underline", "quote"].includes(item.style) &&
            (!item.quote ||
              range.collapsed ||
              normalizeQuoteText(range.toString()).trim() !==
                normalizeQuoteText(item.quote).trim())
          )
            continue;
          const writingMode =
            doc.defaultView?.getComputedStyle(doc.body).writingMode ||
            "horizontal-tb";
          overlayer.add(
            key,
            range,
            drawMark(this.drawing, item, writingMode),
            {},
          );
          drawn.set(key, { signature: item.signature, group, item });
        } catch {
          /* A stale CFI remains in the list; anchoring resolves it separately. */
        }
      }
    }
  }
  hit(view: FoliateView, key: string, index: number) {
    const content = view.renderer
      .getContents()
      .find((content) => content.index === index);
    return content?.overlayer
      ? this.#drawn.get(content.overlayer)?.get(key)
      : undefined;
  }
  clear() {
    for (const [overlayer, marks] of this.#drawn)
      for (const key of marks.keys()) overlayer.remove(key);
    this.#drawn.clear();
    this.#index.clear();
  }
}
