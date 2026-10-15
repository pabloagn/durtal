import type { Decoration, EngineEvents } from "../../engine";
import type { FoliateBook, FoliateView } from "./foliate";
import { pdfRectToPage } from "./pdf-geometry";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";

const NS = "http://www.w3.org/2000/svg";
/** Page-local overlays use real opened page viewports and stored user-unit rectangles. */
export class PdfDecorations {
  #groups = new Map<string, readonly Decoration[]>();
  #documents = new Set<Document>();
  #clicks = new Map<Document, (event: MouseEvent) => void>();
  constructor(private activate: (event: EngineEvents["annotation-activated"]) => void) {}
  /** Marks take no pointer events, so a selection can start on highlighted
   * text. A click that ends on a mark, with nothing selected, opens it. */
  #listen(doc: Document) {
    if (this.#clicks.has(doc)) return;
    const onClick = (event: MouseEvent) => {
      if (doc.getSelection()?.isCollapsed === false) return;
      for (const mark of doc.querySelectorAll<SVGGElement>("[data-durtal-pdf-marks] g[role=button]"))
        for (const box of mark.querySelectorAll("rect")) {
          const r = box.getBoundingClientRect();
          if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top - 2 || event.clientY > r.bottom + 2) continue;
          event.preventDefault(); event.stopPropagation();
          mark.dispatchEvent(new Event("durtal-activate"));
          return;
        }
    };
    doc.addEventListener("click", onClick, true);
    this.#clicks.set(doc, onClick);
  }
  #forget(doc: Document) {
    doc.querySelector("[data-durtal-pdf-marks]")?.remove();
    const onClick = this.#clicks.get(doc);
    if (onClick) doc.removeEventListener("click", onClick, true);
    this.#clicks.delete(doc); this.#documents.delete(doc);
  }
  set(group: string, items: readonly Decoration[]) { this.#groups.set(group, structuredClone(items)); }
  render(view: FoliateView, book: FoliateBook, hash: string, colours: { link: string }) {
    const live = new Set(view.renderer.getContents().map(item => item.doc));
    for (const doc of this.#documents) if (!live.has(doc)) this.#forget(doc);
    for (const { doc, index } of view.renderer.getContents()) {
      const viewport = book.pdfViewport?.(doc);
      if (!viewport) continue; // Nothing is drawn until the actual raster/text viewport is adopted.
      doc.querySelector("[data-durtal-pdf-marks]")?.remove();
      const overlay = doc.createElementNS(NS, "svg");
      overlay.setAttribute("data-durtal-pdf-marks", "");
      overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:4";
      const crop = book.pdfCropOffset?.(doc) ?? { left: 0, top: 0 };
      for (const [group, items] of this.#groups) for (const item of items) {
        if ("cfi" in item || item.locator.fileHash !== hash || item.locator.pdf?.page !== index + 1) continue;
        const color = item.color === "link" ? colours.link : item.color;
        const boxes = item.locator.pdf.rects?.map(rect => pdfRectToPage(rect, viewport, crop)).filter(rect => rect !== null) ?? [];
        const mark = doc.createElementNS(NS, "g");
        mark.setAttribute("data-decoration-id", item.id);
        mark.style.pointerEvents = "none";
        if (item.style === "margin") {
          // A page bookmark is a page-level glyph, never invented passage geometry.
          const glyph = doc.createElementNS(NS, "text");
          glyph.setAttribute("x", String(Math.max(0, doc.documentElement.clientWidth - 20)));
          glyph.setAttribute("y", String(boxes[0]?.top ?? 24));
          glyph.setAttribute("fill", color); glyph.textContent = "◆"; mark.append(glyph);
        } else for (const box of boxes) {
          const rect = doc.createElementNS(NS, "rect");
          const underline = item.style === "underline" || item.style === "quote";
          rect.setAttribute("x", String(box.left)); rect.setAttribute("y", String(underline ? box.bottom - 2 : box.top));
          rect.setAttribute("width", String(Math.max(0, box.right - box.left))); rect.setAttribute("height", String(underline ? 2 : box.bottom - box.top));
          rect.setAttribute("fill", item.style === "outline" ? "none" : color);
          if (item.style === "outline") { rect.setAttribute("stroke", color); rect.setAttribute("stroke-width", item.current ? "3" : "1"); }
          rect.setAttribute("fill-opacity", item.style !== "highlight" ? "1" : group === "annotations" ? String(QUIET_GLASS_ANNOTATION_PALETTE.fillOpacity) : "0.24"); mark.append(rect);
          if (item.style === "quote") { const line = rect.cloneNode(true) as SVGRectElement; line.setAttribute("y", String(box.bottom - 5)); mark.append(line); }
        }
        if (!mark.childNodes.length) continue;
        if (group === "annotations") {
          mark.setAttribute("tabindex", "0"); mark.setAttribute("role", "button"); mark.setAttribute("aria-label", item.note ? "Highlight with note" : "Annotation actions");
          const activate = () => {
            const box = mark.getBoundingClientRect(); const frame = doc.defaultView?.frameElement;
            const host = frame?.getBoundingClientRect();
            const x = host && frame ? host.width / ((frame as HTMLElement).offsetWidth || host.width) : 1;
            const y = host && frame ? host.height / ((frame as HTMLElement).offsetHeight || host.height) : 1;
            this.activate({ group, decorationId: item.id, rect: { left: (host?.left ?? 0) + box.left * x, right: (host?.left ?? 0) + box.right * x,
              top: (host?.top ?? 0) + box.top * y, bottom: (host?.top ?? 0) + box.bottom * y } });
          };
          mark.addEventListener("durtal-activate", activate);
          mark.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } });
        }
        overlay.append(mark);
      }
      doc.body.append(overlay); this.#documents.add(doc); this.#listen(doc);
    }
  }
  destroy() { for (const doc of [...this.#documents]) this.#forget(doc); this.#groups.clear(); }
}
