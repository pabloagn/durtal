"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/*
 * The tab row of every reading page (SLN-448), in its final order. A tab
 * shows only once its page exists, so later steps turn theirs on here and
 * nobody builds a second row.
 */

export const READING_TABS = [
  { href: "/reading", label: "Now", ready: true },
  { href: "/reading/next", label: "Up next", ready: true },
  { href: "/reading/journal", label: "Journal", ready: true },
  { href: "/reading/notes", label: "Notes", ready: true },
  { href: "/reading/stats", label: "Stats", ready: false },
  { href: "/reading/suggestions", label: "Suggestions", ready: false },
  { href: "/reading/import", label: "Import", ready: true },
] as const;

/** The tabs to show and which one is current: Now only on /reading itself, the others on their path and below */
export function readingTabs(pathname: string, tabs: readonly { href: string; label: string; ready: boolean }[] = READING_TABS) {
  return tabs
    .filter((t) => t.ready)
    .map((t) => ({
      href: t.href,
      label: t.label,
      current: t.href === "/reading" ? pathname === "/reading" : pathname === t.href || pathname.startsWith(`${t.href}/`),
    }));
}

export function ReadingTabs() {
  const pathname = usePathname();
  const row = useRef<HTMLUListElement>(null);
  // At 390px the row scrolls inside itself: keep the current tab in view
  useEffect(() => {
    row.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <nav aria-label="Reading" className="mt-6">
      <ul ref={row} className="flex gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
        {readingTabs(pathname).map((tab) => (
          <li key={tab.href} className="shrink-0">
            <Link
              href={tab.href}
              aria-current={tab.current ? "page" : undefined}
              className={`inline-flex h-8 items-center rounded-sm border px-3 text-sm transition-colors pointer-coarse:h-11 ${
                tab.current
                  ? "border-accent-rose/10 bg-accent-plum/80 text-fg-primary"
                  : "border-transparent text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary"
              }`}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
