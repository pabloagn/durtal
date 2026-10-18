"use client";

import { useLayoutEffect } from "react";

const KEY = "durtal-back-scroll:";
/** When Back or Forward last moved through the history */
let traversedAt = -Infinity;
if (typeof window !== "undefined") addEventListener("popstate", () => { traversedAt = performance.now(); });

function read(href: string): number | null {
  try {
    const value = Number(sessionStorage.getItem(KEY + href));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function write(href: string, y: number) {
  try {
    sessionStorage.setItem(KEY + href, String(Math.round(y)));
  } catch {
    // A private window without storage: Back lands where the browser puts it
  }
}

/**
 * Back to a list whose other queries are shorter pages of the same route
 * (/ebooks/highlights and one book's marks): the browser restores the scroll
 * while the shorter page is still shown, so it clamps it, and the list then
 * comes back at full height (SLN-933). This keeps the place the reader left
 * from (saved on the click that leaves) and goes back to it once the list
 * is in. `href` is the list's own URL: its path and its query as
 * URLSearchParams writes it.
 */
export function BackScroll({ href }: { href: string }) {
  useLayoutEffect(() => {
    const saved = read(href);
    if (saved !== null && performance.now() - traversedAt < 2000 && Math.abs(scrollY - saved) > 1) scrollTo(0, saved);
    const leave = () => {
      const query = new URLSearchParams(location.search).toString();
      if (location.pathname + (query ? `?${query}` : "") === href) write(href, scrollY);
    };
    document.addEventListener("click", leave, true);
    return () => document.removeEventListener("click", leave, true);
  }, [href]);
  return null;
}
