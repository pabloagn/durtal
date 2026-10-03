"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { KeyCombo } from "@/components/shortcuts/kbd";

/**
 * One tooltip for the whole app, mounted once in the root layout. Any
 * element with `data-tooltip="Label"` gets it: on hover after 300 ms, at
 * once on keyboard focus. It closes on Escape, on a click, on scroll, and
 * when the pointer or the focus leaves. It works in server components too:
 * the attributes are plain HTML.
 *
 * - `data-tooltip-keys`: the control's shortcut as key tokens (see
 *   `keyLabel`): "b", "alt f", or "a then l" for a sequence.
 * - `data-tooltip-side`: "top" (default), "bottom", "right" or "left". The
 *   tooltip goes to the other side when it does not fit.
 *
 * Text cut short by `truncate`, `lines-1` or `lines-2` shows its full text
 * on hover, with no attribute.
 *
 * An icon-only control keeps its own `aria-label`. A tooltip that says more
 * than the control's name is its description while it shows.
 */

type Side = "top" | "bottom" | "right" | "left";

interface Tip {
  anchor: HTMLElement;
  text: string;
  keys: string[] | null;
  then: boolean;
  side: Side;
  byKeyboard: boolean;
}

const DELAY = 300;
const GAP = 6;
const EDGE = 8;
const SIDES: Side[] = ["top", "bottom", "right", "left"];

function tipFor(target: EventTarget | null, byKeyboard: boolean): Tip | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest<HTMLElement>("[data-tooltip]");
  if (anchor) {
    const text = anchor.dataset.tooltip?.trim();
    // No tooltip on a control whose menu is open
    if (!text || anchor.getAttribute("aria-expanded") === "true") return null;
    const tokens = anchor.dataset.tooltipKeys?.trim().split(/\s+/) ?? null;
    const side = anchor.dataset.tooltipSide as Side | undefined;
    return {
      anchor,
      text,
      keys: tokens?.filter((t) => t !== "then") ?? null,
      then: tokens?.includes("then") ?? false,
      side: side && SIDES.includes(side) ? side : "top",
      byKeyboard,
    };
  }
  if (byKeyboard) return null;
  const cut = cutText(target);
  return cut
    ? { anchor: cut, text: cut.textContent!.trim(), keys: null, then: false, side: "top", byKeyboard }
    : null;
}

/** The nearest text box (up to three levels) that hides part of its text */
function cutText(target: Element): HTMLElement | null {
  let el: Element | null = target;
  for (let depth = 0; el instanceof HTMLElement && depth < 3; depth++, el = el.parentElement) {
    const style = getComputedStyle(el);
    const clamped = style.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1;
    const ellipsis = style.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
    if ((clamped || ellipsis) && el.textContent?.trim()) return el;
  }
  return null;
}

/** Where the tooltip goes: the asked side, else the opposite side if that fits */
function place(anchor: DOMRect, tip: DOMRect, side: Side) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits: Record<Side, boolean> = {
    top: anchor.top - GAP - tip.height >= EDGE,
    bottom: anchor.bottom + GAP + tip.height <= vh - EDGE,
    left: anchor.left - GAP - tip.width >= EDGE,
    right: anchor.right + GAP + tip.width <= vw - EDGE,
  };
  const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const s = fits[side] || !fits[opposite[side]] ? side : opposite[side];
  const clamp = (v: number, max: number) => Math.min(Math.max(v, EDGE), max - EDGE);
  if (s === "top" || s === "bottom")
    return {
      left: clamp(anchor.left + anchor.width / 2 - tip.width / 2, vw - tip.width),
      top: s === "top" ? anchor.top - GAP - tip.height : anchor.bottom + GAP,
    };
  return {
    left: s === "left" ? anchor.left - GAP - tip.width : anchor.right + GAP,
    top: clamp(anchor.top + anchor.height / 2 - tip.height / 2, vh - tip.height),
  };
}

/** The control's own name, to skip a description that repeats it */
function accessibleName(el: HTMLElement) {
  return (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
}

export function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const shown = useRef<Tip | null>(null);

  useEffect(() => {
    let timer = 0;
    let pending: HTMLElement | null = null;
    let closedAt = 0;
    // A click closes the tooltip until the pointer leaves that control
    let clicked: HTMLElement | null = null;

    const show = (next: Tip, delay: number) => {
      window.clearTimeout(timer);
      pending = next.anchor;
      timer = window.setTimeout(() => {
        pending = null;
        setTip(next);
      }, delay);
    };
    const hide = () => {
      window.clearTimeout(timer);
      pending = null;
      if (shown.current) closedAt = performance.now();
      setTip(null);
    };

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const next = tipFor(e.target, false);
      const current = shown.current?.anchor ?? pending;
      if (next && (next.anchor === current || next.anchor === clicked)) return;
      clicked = null;
      if (!next) return hide();
      // Moving from one tooltip to the next skips the wait
      show(next, shown.current || performance.now() - closedAt < DELAY ? 0 : DELAY);
    };
    const onPointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };
    const onPointerDown = (e: PointerEvent) => {
      clicked = tipFor(e.target, false)?.anchor ?? null;
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(":focus-visible")) return;
      const next = tipFor(el, true);
      if (next && next.anchor === el) show(next, 0);
      else if (shown.current?.byKeyboard) hide();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (shown.current?.byKeyboard && shown.current.anchor === e.target) hide();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(shown.current || pending)) return;
      // Pressing the control (it may open a menu) closes its tooltip
      if (e.key === "Enter" || e.key === " ") return hide();
      if (e.key !== "Escape") return;
      // Escape closes a focus tooltip first; a hover tooltip lets it through
      if (shown.current?.byKeyboard) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      hide();
    };

    window.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, []);

  // Show in the top layer (above open dialogs), next to the anchor
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = shown.current;
    shown.current = tip;
    if (previous && previous.anchor !== tip?.anchor) undescribe(previous.anchor);
    if (el.matches(":popover-open")) el.hidePopover();
    if (!tip) return;

    el.showPopover();
    const { left, top } = place(tip.anchor.getBoundingClientRect(), el.getBoundingClientRect(), tip.side);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    if (!accessibleName(tip.anchor).toLowerCase().includes(tip.text.toLowerCase()))
      describe(tip.anchor, el.id);

    // A control that leaves the page takes its tooltip with it
    const watch = window.setInterval(() => {
      if (!tip.anchor.isConnected) setTip(null);
    }, 250);
    return () => window.clearInterval(watch);
  }, [tip]);

  return (
    <div
      ref={ref}
      id="app-tooltip"
      role="tooltip"
      popover="manual"
      className="pointer-events-none fixed inset-auto m-0 max-w-80 overflow-visible rounded-sm border border-glass-border bg-bg-secondary px-2.5 py-1 text-xs text-fg-primary shadow-lg transition-opacity duration-150 starting:opacity-0"
    >
      {tip && (
        <span className="flex items-center gap-2">
          <span>{tip.text}</span>
          {tip.keys && <KeyCombo keys={tip.keys} then={tip.then} />}
        </span>
      )}
    </div>
  );
}

function describe(anchor: HTMLElement, id: string) {
  const ids = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  if (!ids.includes(id)) anchor.setAttribute("aria-describedby", [...ids, id].join(" "));
}

function undescribe(anchor: HTMLElement) {
  const ids = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((i) => i && i !== "app-tooltip");
  if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" "));
  else anchor.removeAttribute("aria-describedby");
}
