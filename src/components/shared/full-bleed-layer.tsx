"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { bleedInsets } from "@/lib/utils/full-bleed";

/**
 * Backdrop layer that fills its positioned parent vertically and the whole
 * `main` area horizontally, whatever the window or sidebar width.
 *
 * The shell centers every page in a max-width column, so plain CSS cannot
 * reach the edges of `main` without side effects (100vw counts the scrollbar;
 * container queries on an ancestor break fixed toolbars). The layer measures
 * instead and follows every resize, including the sidebar drag and transition.
 *
 * Offsets are written straight to the element inside the ResizeObserver
 * callback, so the browser applies them in the same frame: no lag during the
 * sidebar animation and no momentary horizontal scroll. The layer stays
 * hidden until the first measurement, then fades in.
 */
export function FullBleedLayer({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    const layer = ref.current;
    const host = layer?.offsetParent;
    const frame = layer?.closest("main");
    if (!layer || !(host instanceof HTMLElement) || !frame) {
      setMeasured(true);
      return;
    }
    const update = () => {
      const { left, right } = bleedInsets(
        host.getBoundingClientRect(),
        frame.getBoundingClientRect(),
      );
      layer.style.left = `${-left}px`;
      layer.style.right = `${-right}px`;
      setMeasured(true);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className={`absolute inset-0 overflow-hidden transition-opacity duration-300 ${measured ? "opacity-100" : "opacity-0"} ${className}`}
    >
      {children}
    </div>
  );
}
