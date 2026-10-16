"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Where the keyboard focus goes when the app moves to another page (focus
 * survey, cause 5). The focus was on a control of the page that went, so it
 * fell to the body, and the next Tab started again from the top of the
 * browser's chrome: after a palette pick, a renamed book's new address, a
 * deleted collection.
 *
 * On a new path, while the focus is lost, it goes to the same named control
 * on the new page when there is one (a renamed book's Actions, which had it
 * before the move), else to the page's heading. A list that pages keeps its
 * own path and its own target (`Pagination`). The new page may stream in
 * after a loading screen, so the check runs until it settles or the reader
 * puts the focus somewhere.
 */

const SETTLE_MS = 5000;

/** A control's name and its place among the controls of that name */
type Named = { label: string; index: number };

function named(el: Element): Named | null {
  const label = el.getAttribute("aria-label");
  if (!label || !el.matches("a[href], button")) return null;
  const main = el.closest("main");
  if (!main) return null;
  const same = [...main.querySelectorAll(`[aria-label="${CSS.escape(label)}"]`)].filter((other) => other.matches("a[href], button"));
  return { label, index: same.indexOf(el) };
}

function counterpart(was: Named): HTMLElement | null {
  const same = [...document.querySelectorAll<HTMLElement>(`main [aria-label="${CSS.escape(was.label)}"]`)].filter(
    (el) => el.matches("a[href], button") && el.getClientRects().length > 0,
  );
  return same[was.index] ?? null;
}

export function headingOf(): HTMLElement | null {
  const heading = document.querySelector<HTMLElement>("main h1");
  if (heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  return heading;
}

function lost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

export function NavigationFocus() {
  const pathname = usePathname();
  const last = useRef<{ el: Element; name: Named | null } | null>(null);
  const shown = useRef(pathname);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target as Element;
      if (el instanceof HTMLElement && el !== document.body) last.current = { el, name: named(el) };
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    const was = last.current;
    let placed: HTMLElement | null = null;
    let frame = 0;
    const place = () => {
      frame = 0;
      // The reader put the focus somewhere: theirs to keep
      if (!lost() && document.activeElement !== placed) return stop();
      if (!lost() || document.querySelector("dialog[open]")) return;
      const target = (was?.name && !was.el.isConnected ? counterpart(was.name) : null) ?? headingOf();
      if (!target) return;
      target.focus({ preventScroll: true });
      placed = target;
    };
    // Again whenever the page changes while it settles (a loading screen
    // gives way to the page, and the focus with it)
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const observer = new MutationObserver(schedule);
    const timer = setTimeout(() => stop(), SETTLE_MS);
    function stop() {
      observer.disconnect();
      clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
    return stop;
  }, [pathname]);

  return null;
}
