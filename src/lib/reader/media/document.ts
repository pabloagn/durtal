import { physicalTableScrollLeft, tableCanTakeSwipe } from "./table-policy";
import { viewerImage, type ReaderMedia } from "./content";
import { TAP_ZONE } from "../input";

/** Two taps this close in time and place are a double tap */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP = 30;

/** Installs trusted document input. DOM unit tests exercise policy, never prove native gestures.
 * With `pageImages` (a comic or fixed-layout book, whose pages are images),
 * one tap on an image is the page's (it turns at an edge, or shows the
 * bars) and a double tap away from the edges opens it in the viewer. */
export function attachReaderMedia(
  doc: Document,
  publish: (media: ReaderMedia) => void,
  { pageImages = false }: { pageImages?: boolean } = {},
) {
  const view = doc.defaultView;
  if (!view) return () => {};
  const wrapped = new Set<HTMLTableElement>();
  let destroyed = false;
  let frame = 0;
  let touch: {
    x: number;
    y: number;
    target: EventTarget | null;
    table: HTMLElement | null;
    lastX: number;
    at: number;
    claimed: boolean;
  } | null = null;
  let lastTap: { x: number; y: number; at: number } | null = null;
  const open = (element: Element, kind: ReaderMedia["kind"]) =>
    publish({
      kind,
      element,
      reference: element as HTMLElement,
      caption: (
        element.getAttribute("alt") ||
        element.closest("figure")?.querySelector("figcaption")?.textContent ||
        element.querySelector("caption")?.textContent ||
        ""
      ).trim(),
    });
  const layout = () => {
    frame = 0;
    if (destroyed) return;
    for (const table of doc.querySelectorAll<HTMLTableElement>("table")) {
      if (table.closest("[data-durtal-wide-table]") || wrapped.has(table))
        continue;
      // The rendered column bounds are physical, independent of writing direction.
      const viewport = Math.min(
        view.innerWidth,
        table.parentElement?.clientWidth || view.innerWidth,
      );
      if (table.scrollWidth <= viewport + 0.5) continue;
      const wrapper = doc.createElement("div");
      wrapper.setAttribute("cfi-skip", "");
      wrapper.setAttribute("data-durtal-wide-table", "");
      wrapper.tabIndex = 0;
      wrapper.setAttribute("aria-label", "Table scrolls sideways");
      wrapper.style.cssText =
        "max-width:100%;overflow-x:auto;touch-action:pan-y;";
      table.before(wrapper);
      wrapper.append(table);
      wrapped.add(table);
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = "View table";
      button.setAttribute("cfi-inert", "");
      button.setAttribute("data-reader-chrome", "");
      button.style.cssText =
        "font:inherit;font-size:14px;color:inherit;min-height:44px;background:transparent;border:0;padding:4px 8px;cursor:pointer;";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        open(table, "table");
      });
      wrapper.after(button);
    }
  };
  const schedule = () => {
    if (!frame && !destroyed) frame = view.requestAnimationFrame(layout);
  };
  const observer = new view.ResizeObserver(schedule);
  observer.observe(doc.documentElement);
  for (const table of doc.querySelectorAll("table")) observer.observe(table);
  schedule();
  const doubleClick = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const image = viewerImage(event.target);
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    open(image, "image");
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      touch = null;
      return;
    }
    const point = event.touches[0];
    const target = event.target as Element | null;
    touch = {
      x: point.clientX,
      y: point.clientY,
      lastX: point.clientX,
      at: performance.now(),
      target,
      table: target?.closest?.("[data-durtal-wide-table]") ?? null,
      claimed: false,
    };
  };
  const move = (event: TouchEvent) => {
    if (!touch || event.touches.length !== 1 || !touch.table) return;
    const point = event.touches[0];
    const dx = point.clientX - touch.x;
    if (
      !touch.claimed &&
      (Math.abs(dx) < 8 ||
        Math.abs(dx) <= Math.abs(point.clientY - touch.y) * 1.5)
    )
      return;
    const table = touch.table;
    const dir =
      view.getComputedStyle(table).direction === "rtl" ? "rtl" : "ltr";
    const canScroll = tableCanTakeSwipe(
      {
        left: physicalTableScrollLeft(
          table.scrollLeft,
          table.scrollWidth - table.clientWidth,
          dir,
        ),
        width: table.scrollWidth,
        viewport: table.clientWidth,
      },
      dx,
    );
    if (!touch.claimed && !canScroll) return;
    touch.claimed = true;
    event.preventDefault();
    event.stopPropagation();
    table.scrollLeft -= point.clientX - touch.lastX;
    touch.lastX = point.clientX;
  };
  const end = (event: TouchEvent) => {
    const gesture = touch;
    touch = null;
    if (!gesture || event.touches.length) return;
    if (gesture.claimed) {
      event.preventDefault();
      return;
    }
    const point = event.changedTouches[0];
    if (
      !point ||
      Math.hypot(point.clientX - gesture.x, point.clientY - gesture.y) > 10
    )
      return;
    if (
      performance.now() - gesture.at >= 500 ||
      doc.getSelection()?.toString().trim()
    )
      return;
    const image = viewerImage(gesture.target);
    if (!image) return;
    if (pageImages) {
      // The edge strips turn pages, however fast they are tapped
      const frame = view.frameElement?.getBoundingClientRect();
      const width = view.top?.innerWidth ?? view.innerWidth;
      const x = ((frame?.left ?? 0) + point.clientX) / width;
      const at = performance.now();
      const previous = lastTap;
      lastTap = null;
      if (x < TAP_ZONE || x > 1 - TAP_ZONE) return;
      if (
        !previous ||
        at - previous.at > DOUBLE_TAP_MS ||
        Math.hypot(point.clientX - previous.x, point.clientY - previous.y) >
          DOUBLE_TAP_SLOP
      ) {
        lastTap = { x: point.clientX, y: point.clientY, at };
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    open(image, "image");
  };
  const cancelTouch = () => {
    touch = null;
  };
  const wheel = (event: WheelEvent) => {
    const table = (event.target as Element | null)?.closest?.<HTMLElement>(
      "[data-durtal-wide-table]",
    );
    if (
      !table ||
      event.ctrlKey ||
      (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    table.scrollLeft += event.shiftKey ? event.deltaY : event.deltaX;
  };
  const key = (event: KeyboardEvent) => {
    const table = (event.target as Element | null)?.closest?.<HTMLElement>(
      "[data-durtal-wide-table]",
    );
    if (
      !table ||
      !["ArrowLeft", "ArrowRight"].includes(event.key) ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    table.scrollLeft +=
      (event.key === "ArrowLeft" ? -1 : 1) * table.clientWidth * 0.1;
  };
  doc.addEventListener("dblclick", doubleClick, true);
  doc.addEventListener("touchstart", start, { capture: true, passive: true });
  doc.addEventListener("touchmove", move, { capture: true, passive: false });
  doc.addEventListener("touchend", end, true);
  doc.addEventListener("touchcancel", cancelTouch, true);
  doc.addEventListener("wheel", wheel, { capture: true, passive: false });
  doc.addEventListener("keydown", key, true);
  return () => {
    destroyed = true;
    observer.disconnect();
    if (frame) view.cancelAnimationFrame(frame);
    doc.removeEventListener("dblclick", doubleClick, true);
    doc.removeEventListener("touchstart", start, true);
    doc.removeEventListener("touchmove", move, true);
    doc.removeEventListener("touchend", end, true);
    doc.removeEventListener("touchcancel", cancelTouch, true);
    doc.removeEventListener("wheel", wheel, true);
    doc.removeEventListener("keydown", key, true);
  };
}
