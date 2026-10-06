"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import type { WhyPart } from "@/lib/reading/suggest/view";

/**
 * Why this? (SLN-457): every feature's share of the score as a labelled bar,
 * its reason and its evidence links, in a glass popover. A feature that
 * lowers the score says so.
 */
export function WhyThis({ title, parts, prediction }: { title: string; parts: WhyPart[]; prediction?: string | null }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  // Under the button, or above it when the screen ends first; always inside a 16px gutter
  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open" || !button.current) return;
      const b = button.current.getBoundingClientRect();
      const width = Math.min(352, window.innerWidth - 32);
      el.style.width = `${width}px`;
      el.style.left = `${Math.max(16, Math.min(b.left, window.innerWidth - 16 - width))}px`;
      const below = b.bottom + 4;
      el.style.top = `${below + el.offsetHeight > window.innerHeight - 16 ? Math.max(16, b.top - 4 - el.offsetHeight) : below}px`;
    };
    el.addEventListener("toggle", place);
    return () => el.removeEventListener("toggle", place);
  }, []);

  const sorted = [...parts].sort((a, b) => Number(a.lowers) - Number(b.lowers) || b.share - a.share);
  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        className="inline-flex h-8 items-center rounded-sm px-2 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary/50 hover:text-fg-primary pointer-coarse:h-11"
        data-why-open=""
      >
        Why this?
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={`Why ${title}`}
        className="glass fixed inset-auto m-0 overflow-hidden border-0 bg-transparent p-0 text-xs text-fg-primary"
        data-why-popover=""
      >
        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
          <p className="text-fg-secondary">What makes {title} a suggestion, by its share of the score</p>
          {prediction && <p data-why-prediction="">{prediction}</p>}
          <ul className="space-y-3">
            {sorted.map((part) => (
              <li key={part.key} data-why-part={part.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-fg-primary">{part.label}</span>
                  <span className="shrink-0 text-fg-secondary tabular-nums">{part.lowers ? "halves the score" : `${Math.round(part.share * 100)}%`}</span>
                </div>
                {!part.lowers && (
                  <div className="mt-1 h-1 rounded-sm bg-bg-tertiary" aria-hidden>
                    <div className="h-full rounded-sm bg-accent-sage/70" style={{ width: `${Math.max(2, part.share * 100)}%` }} />
                  </div>
                )}
                {part.reason && <p className="mt-1 text-fg-secondary">{part.reason}</p>}
                {part.evidence.length > 0 && (
                  <p className="mt-1 text-fg-secondary">
                    {part.evidence.map((e, i) => (
                      <span key={`${e.label}-${i}`}>
                        {i > 0 && " · "}
                        {e.href ? (
                          <Link href={e.href} className="text-fg-primary underline-offset-2 hover:underline">
                            {e.label}
                          </Link>
                        ) : (
                          e.label
                        )}
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
