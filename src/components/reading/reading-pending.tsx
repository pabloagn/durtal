"use client";

import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { buttonClass } from "@/components/ui/button";
import { SkeletonBlock, SkeletonLine } from "@/components/shared/skeleton";

/** Each tab's header buttons, held at their own width so they wrap where the page's do */
const HELD: Record<string, { label: string; menu?: boolean }[]> = {
  "/reading": [{ label: "Log a past read" }, { label: "Start a book" }, { label: "Goals", menu: true }],
  "/reading/next": [{ label: "Log a past read" }, { label: "Start a book" }],
  "/reading/journal": [{ label: "Log a past read" }, { label: "Start a book" }],
  "/reading/import": [{ label: "Log a past read" }, { label: "Start a book" }],
  "/reading/notes": [{ label: "Add a quote" }],
  "/reading/stats": [{ label: "Set a reading goal" }, { label: "Year in review" }],
  "/reading/suggestions": [{ label: "Pick one for me" }],
};

/** The title, label and buttons of the reading page at this address */
function screen(pathname: string): { title: string; label: string; held: { label: string; menu?: boolean }[] } {
  if (pathname === "/reading/year") return { title: "Year in review", label: "Loading the years in review", held: [] };
  // One year in review (SLN-815): Print, then that year's stats
  const year = /^\/reading\/year\/(\d{4})$/.exec(pathname)?.[1];
  if (year) return { title: `${year} in review`, label: "Loading the year in review", held: [{ label: "Print" }, { label: `Stats for ${year}` }] };
  // One import's preview (SLN-815) keeps the hub's header and buttons
  if (pathname.startsWith("/reading/import/")) return { title: "Reading", label: "Loading the import", held: HELD["/reading/import"] };
  return { title: "Reading", label: "Loading reading", held: HELD[pathname] ?? [] };
}

/**
 * A reading page while it loads (SLN-749): its header, with the tab just
 * clicked current and its buttons held, then its first section held. A
 * prefetched link draws this one screen for every tab, so the address says
 * which title and buttons are coming; the buttons keep their labels' widths,
 * hidden, so on a phone they go under the title where the page's do. A year
 * in review and an import preview draw it too, from their own loading
 * screens (SLN-815).
 */
export function ReadingPending() {
  const { title, label, held } = screen(usePathname());
  return (
    <div role="status" aria-label={label}>
      <PageHeader
        title={title}
        actions={
          held.length
            ? held.map(({ label, menu }) => (
                <span
                  key={label}
                  aria-hidden="true"
                  className={`${buttonClass("secondary")} pointer-coarse:h-11 pointer-events-none bg-bg-tertiary! text-transparent! motion-safe:animate-pulse`}
                >
                  {label}
                  {menu && <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />}
                </span>
              ))
            : undefined
        }
        tabs={<ReadingTabs />}
      />
      <SkeletonLine className="type-section-title mb-4 w-48" />
      <SkeletonBlock className="h-64" />
    </div>
  );
}
