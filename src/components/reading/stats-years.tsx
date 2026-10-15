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
  // Keep the chosen year in view
  useEffect(() => {
    row.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [chosen]);
  return (
    <nav aria-label="Year" className="-mt-4 mb-8">
      <ul ref={row} className="flex gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none]" data-stats-years="">
        {years.map((y) => (
          <li key={y.label} className="shrink-0">
            <Link
              href={y.href}
              aria-current={y.current ? "page" : undefined}
              className={`inline-flex h-7 items-center rounded-sm border px-2.5 text-xs transition-colors pointer-coarse:h-11 ${
                y.current ? "border-glass-border text-fg-primary" : "border-transparent text-fg-secondary hover:text-fg-primary"
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
