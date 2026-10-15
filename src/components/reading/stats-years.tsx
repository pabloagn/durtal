"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

/**
 * The Stats page's years, under the Reading tabs: one row that scrolls
 * sideways, since a long record holds dozens of years, and smaller and
 * quieter than the tabs, so the two rows read apart (SLN-800 review).
 */
export function StatsYears({ years }: { years: { label: string; href: string; current: boolean }[] }) {
  const row = useRef<HTMLUListElement>(null);
  const chosen = years.find((y) => y.current)?.label;
  // A chosen year out of view starts the row, so the row begins on a whole year
  useEffect(() => {
    const ul = row.current, chip = ul?.querySelector('[aria-current="page"]');
    if (!ul || !chip) return;
    const box = ul.getBoundingClientRect(), at = chip.getBoundingClientRect();
    if (at.right > box.right + 0.5 || at.left < box.left - 0.5) ul.scrollLeft += at.left - box.left;
  }, [chosen]);
  return (
    <nav aria-label="Year" className="-mt-4 mb-8">
      {/* Pulled out by a chip's padding, so a year's text starts on the page's
          edge; scrolling stops on a whole year */}
      <ul ref={row} className="-ml-2.5 flex snap-x snap-mandatory gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none]" data-stats-years="">
        {years.map((y) => (
          <li key={y.label} className="shrink-0 snap-start">
            <Link
              href={y.href}
              aria-current={y.current ? "page" : undefined}
              className={`inline-flex h-7 items-center rounded-sm px-2.5 text-xs transition-colors pointer-coarse:h-11 ${
                y.current ? "text-fg-primary ring-1 ring-glass-border ring-inset" : "text-fg-secondary hover:text-fg-primary"
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
