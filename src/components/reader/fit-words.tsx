"use client";
import { useLayoutEffect, useRef, useState } from "react";

const ELLIPSIS = "…";

/** The longest run of whole words that fits `room`, with an ellipsis when
 * words were dropped; "" when not even the first word fits */
export function fitWords(text: string, room: number, measure: (prefix: string) => number): string {
  if (measure(text) <= room + 0.5) return text;
  const ends = [...text.matchAll(/\S+/g)].map((word) => (word.index ?? 0) + word[0].length);
  for (let n = ends.length - 1; n > 0; n--) {
    const shown = text.slice(0, ends[n - 1]).replace(/[\s,;:.–-]+$/, "") + ELLIPSIS;
    if (measure(shown) <= room + 0.5) return shown;
  }
  return "";
}

/**
 * One line of bar text that is never cut inside a word (SLN-730): words drop
 * from the end, with an ellipsis, until it fits; `whole` shows all or none.
 * It sizes as the full text would, so a flex row gives it the same room
 * whatever it shows; screen readers always hear the full text.
 */
export function FitWords({ text, whole = false, className = "" }: { text: string; whole?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      // A probe in the same font measures each candidate, then goes
      const probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;white-space:pre";
      element.append(probe);
      const measure = (candidate: string) => {
        probe.textContent = candidate;
        return probe.getBoundingClientRect().width;
      };
      const room = element.clientWidth;
      const next = whole ? (measure(text) <= room + 0.5 ? text : "") : fitWords(text, room, measure);
      probe.remove();
      setShown(next);
    };
    fit();
    // A web font that arrives late changes every width, but not the room
    const fonts = typeof document.fonts?.addEventListener === "function" ? document.fonts : null;
    fonts?.addEventListener("loadingdone", fit);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(element);
    return () => {
      fonts?.removeEventListener("loadingdone", fit);
      observer?.disconnect();
    };
  }, [text, whole]);
  return (
    <span
      ref={ref}
      data-fit-words={text}
      className={`relative block min-w-0 overflow-hidden whitespace-nowrap before:invisible before:block before:h-0 before:content-[attr(data-fit-words)] ${className}`}
    >
      {shown === text ? text : (
        <>
          <span className="sr-only">{text}</span>
          <span aria-hidden>{shown}</span>
        </>
      )}
    </span>
  );
}
