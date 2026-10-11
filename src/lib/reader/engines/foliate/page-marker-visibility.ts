/** A real publisher marker needs a measured position in its mounted reader viewport.
 * Empty inline pagebreaks have genuine0x0 client rects; no positive area is invented.
 * Unproved transforms/clips fail closed to the ordinary observed page label.
 */
export function pageMarkerPhysicallyVisible(marker: Range | Element, doc: Document, renderer: HTMLElement): boolean {
  try {
    const node = "startContainer" in marker ? marker.startContainer : marker;
    if (node.ownerDocument !== doc || !node.isConnected) return false;
    const frame = doc.defaultView?.frameElement as HTMLIFrameElement | null;
    if (!frame?.isConnected || frame.contentDocument !== doc || !doc.defaultView) return false;
    const parent = (el: Element): Element | null => el.parentElement ?? (el.getRootNode() as ShadowRoot).host ?? null;
    const unsupported = (el: Element) => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el);
      return style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" ||
        Number(style.opacity || 1) === 0 || style.contentVisibility === "hidden" ||
        (style.transform && style.transform !== "none") ||
        (style.rotate && style.rotate !== "none") || (style.scale && style.scale !== "none") ||
        (style.translate && style.translate !== "none") ||
        // Legacy clip and paint containment can suppress paint while retaining
        // native client rects. Their clip semantics are not proved by this guard.
        (style.clip && style.clip !== "auto") ||
        /(?:^|\s)(?:paint|strict|content)(?:\s|$)/.test(style.contain) ||
        (style.clipPath && style.clipPath !== "none") ||
        (style.maskImage && style.maskImage !== "none") ||
        !["", "1", "normal"].includes(style.zoom);
    };
    const clipped = (el: Element, x: number, y: number) => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el);
      const clipX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX);
      const clipY = ["hidden", "clip", "auto", "scroll"].includes(style.overflowY);
      if (!clipX && !clipY) return false;
      const box = el as HTMLElement, rect = el.getBoundingClientRect();
      if (!box.offsetWidth || !box.offsetHeight) return true;
      const sx = rect.width / box.offsetWidth, sy = rect.height / box.offsetHeight;
      const left = rect.left + box.clientLeft * sx, top = rect.top + box.clientTop * sy;
      return (clipX && (x < left || x >= left + box.clientWidth * sx)) ||
        (clipY && (y < top || y >= top + box.clientHeight * sy));
    };
    const chain: Element[] = [];
    for (let el: Element | null = frame; el; el = parent(el)) {
      if (unsupported(el)) return false;
      chain.push(el);
    }
    if (!chain.includes(renderer)) return false;
    const anchorParents: Element[] = [];
    for (let el = node.nodeType === 1 ? node as Element : node.parentElement; el; el = el.parentElement) {
      if (unsupported(el)) return false;
      anchorParents.push(el);
    }
    const host = frame.getBoundingClientRect();
    if (!frame.offsetWidth || !frame.offsetHeight || !host.width || !host.height) return false;
    const scaleX = host.width / frame.offsetWidth, scaleY = host.height / frame.offsetHeight;
    const win = frame.ownerDocument.defaultView;
    if (!win) return false;
    return Array.from(marker.getClientRects()).some(rect => {
      // A native zero-area rect is a real boundary point. A rectless hidden
      // element is not; boundingClientRect alone would fabricate an origin.
      const x = rect.left, y = rect.top;
      if (![x, y, scaleX, scaleY].every(Number.isFinite) || scaleX <= 0 || scaleY <= 0 ||
          x < 0 || x >= doc.defaultView!.innerWidth || y < 0 || y >= doc.defaultView!.innerHeight) return false;
      // HTML's multicolumn border box is only one column wide while its native
      // client viewport spans the loaded section (confirmed in all six receipts).
      // Clip it by the actual iframe viewport above, not that logical border box.
      if (anchorParents.some(el => el !== doc.documentElement && clipped(el, x, y))) return false;
      const hostX = host.left + (frame.clientLeft + x) * scaleX;
      const hostY = host.top + (frame.clientTop + y) * scaleY;
      if (hostX < 0 || hostX >= win.innerWidth || hostY < 0 || hostY >= win.innerHeight) return false;
      return chain.every(el => !clipped(el, hostX, hostY));
    });
  } catch {
    // Retired/cross-origin frames and unsupported geometry cannot prove a label.
    return false;
  }
}
