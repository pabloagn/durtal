"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

/**
 * The Stats page's years, under the Reading tabs: on touch one row that
 * scrolls sideways, since a long record holds dozens of years; with a mouse
 * they wrap. Smaller and quieter than the tabs, so the two rows read apart
 * (SLN-800 review), with the chosen year filled so it stands out (SLN-821).
 */
export function StatsYears({ years }: { years: { label: string; href: string; current: boolean }[] }) {
  const row = useRef<HTMLUListElement>(null);
  const chosen = years.find((y) => y.current)?.label;
  // A chosen year out of view starts the row, so the row begins on a whole year
  useEffect(() => {
    const ul = row.current, chip = ul?.querySelector('[aria-current="page"]');
    if (!ul || !chip) return;
    ul.style.paddingInlineEnd = "";
    const box = ul.getBoundingClientRect(), at = chip.getBoundingClientRect();
    if (at.right <= box.right + 0.5 && at.left >= box.left - 0.5) return;
    const max = ul.scrollWidth - ul.clientWidth;
    let start = ul.scrollLeft + at.left - box.left;
    if (start > max) {
      // One of the last years cannot reach the start, and the row's end
      // would begin partway through a year: begin on the first whole year
      // there, with the little room that takes after the last one
      const starts = [...ul.querySelectorAll("a")].map((a) => ul.scrollLeft + a.getBoundingClientRect().left - box.left);
      start = Math.min(...starts.filter((s) => s >= max - 0.5));
      if (start > max) ul.style.paddingInlineEnd = `${Math.ceil(start - max)}px`;
    }
    ul.scrollLeft = start;
  }, [chosen]);
  return (
    <nav aria-label="Year" className="-mt-4 mb-8">
      {/* A row of chips with a filled chosen year, so it lines up by its
          boxes like the tabs above: a pulled-out row put the chosen year's
          fill past the page's edge. On touch one row that scrolls and stops on
          a whole year; with a mouse, which has no swipe and no scrollbar here,
          the years wrap (SLN-821) */}
      <ul ref={row} className="flex snap-x snap-mandatory gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] pointer-fine:flex-wrap pointer-fine:overflow-x-visible" data-stats-years="">
        {years.map((y) => (
          <li key={y.label} className="shrink-0 snap-start">
            <Link
              href={y.href}
              aria-current={y.current ? "page" : undefined}
              className={`inline-flex h-7 items-center rounded-sm px-2.5 text-xs transition-colors pointer-coarse:h-11 ${
                y.current ? "bg-bg-tertiary text-fg-primary ring-1 ring-glass-border ring-inset" : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {y.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
