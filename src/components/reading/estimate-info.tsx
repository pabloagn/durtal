"use client";

import { useEffect, useId, useRef } from "react";
import { Info } from "lucide-react";

/*
 * The info button beside an estimate (SLN-451) or a goal (SLN-455): a glass
 * popover that says what the number is based on, one line per paragraph. A
 * native popover, so it sits above cards that clip, closes on Escape and on
 * a click outside.
 */

const LABEL = "How this estimate is made";

export function EstimateInfo({ text, label = LABEL }: { text: string; label?: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  // Placed under the button, or above it when the screen ends first; always inside a 16px gutter
  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open" || !button.current) return;
      const b = button.current.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 32);
      el.style.width = `${width}px`;
      el.style.left = `${Math.max(16, Math.min(b.left, window.innerWidth - 16 - width))}px`;
      const below = b.bottom + 4;
      el.style.top = `${below + el.offsetHeight > window.innerHeight - 16 ? Math.max(16, b.top - 4 - el.offsetHeight) : below}px`;
    };
    el.addEventListener("toggle", place);
    return () => el.removeEventListener("toggle", place);
  }, []);

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-label={label}
        data-tooltip={label}
        data-estimate-info=""
        className="flex h-6 w-6 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:h-11 pointer-coarse:w-11"
      >
        <Info className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        className="glass fixed inset-auto m-0 overflow-hidden border-0 p-3 text-xs leading-relaxed whitespace-pre-line text-fg-primary"
        data-estimate-popover=""
      >
        {text}
      </div>
    </>
  );
}
