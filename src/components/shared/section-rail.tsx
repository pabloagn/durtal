"use client";

import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";

export interface RailSection {
  /** The id of the section's element on the page */
  id: string;
  /** Its name in the outline, as its heading says it */
  label: string;
}

/** Where the reader is: the last section whose top has passed this share of the window */
const READING_LINE = 0.35;

/** The section being read, or -1 above the first one */
function currentIndex(sections: RailSection[]) {
  // At the foot of the page the last section is the one being read, however short
  const root = document.documentElement;
  if (window.scrollY + window.innerHeight >= root.scrollHeight - 2) return sections.length - 1;
  let index = -1;
  sections.forEach((section, i) => {
    const element = document.getElementById(section.id);
    if (element && element.getBoundingClientRect().top <= window.innerHeight * READING_LINE) index = i;
  });
  return index;
}

function goTo(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  // The keyboard carries on from the section, as a link to it would
  element.focus({ preventScroll: true });
}

/**
 * A page's sections as a rail of ticks on the window's right edge (SLN-740),
 * as Notion draws a long page's outline: one tick per section, the one being
 * read longer and brightest, those already passed brighter than those ahead.
 * Pointing at the rail, or tabbing into it, opens the outline on glass; a
 * name scrolls to its section.
 *
 * A touch screen has no hover and a phone no margin for the rail: there the
 * outline is a small glass button at the bottom right, naming the section
 * being read, that opens it as a menu. It shows from the first section on,
 * so it never covers the page's title.
 *
 * Each section needs its `id`, `tabIndex={-1}` (focus follows a jump) and a
 * scroll margin. Fewer than three sections draw nothing.
 */
export function SectionRail({ sections, label }: { sections: RailSection[]; label: string }) {
  const [reached, setReached] = useState(-1);
  // Above the first section, the rail marks the first one ahead
  const current = Math.max(reached, 0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setReached(currentIndex(sections)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sections]);

  const jump = useCallback((event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    goTo(id);
  }, []);

  if (sections.length < 3) return null;

  return (
    <>
      <nav
        aria-label={label}
        className="section-rail group fixed right-1.5 top-1/2 z-30 hidden -translate-y-1/2 md:block pointer-coarse:hidden print:hidden"
        data-section-rail=""
      >
        {/* The ticks: a picture of the outline. The names below carry it for a screen reader */}
        <div aria-hidden="true" className="flex flex-col items-end gap-2.5 py-3 pl-3 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
          {sections.map((section, i) => (
            <span
              key={section.id}
              data-rail-tick={i === current ? "current" : i < current ? "passed" : "ahead"}
              className={`block h-0.5 rounded-full transition-[width,background-color] duration-200 ${
                i === current ? "w-4 bg-fg-heading" : i < current ? "w-2.5 bg-fg-secondary" : "w-2.5 bg-fg-muted"
              }`}
            />
          ))}
        </div>
        {/* The outline opens over the ticks, centered on them */}
        <div className="glass pointer-events-none invisible absolute right-0 top-1/2 w-56 -translate-y-1/2 overflow-hidden rounded-md p-2 opacity-0 transition-[opacity,visibility] duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100">
          <ol>
            {sections.map((section, i) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={(event) => jump(event, section.id)}
                  aria-current={i === current ? "location" : undefined}
                  className={`relative block rounded-sm px-2.5 py-1.5 text-xs [overflow-wrap:break-word] transition-colors hover:bg-bg-tertiary focus-visible:bg-bg-tertiary ${
                    i === current
                      ? "text-fg-heading before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-fg-heading"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>
      {reached >= 0 && (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 md:pointer-fine:hidden print:hidden" data-section-rail-touch="">
          <DropdownMenu
            side="top"
            align="end"
            trigger={
              <button
                aria-label={`${sections[current]?.label}, section ${current + 1} of ${sections.length}. ${label}`}
                className="glass flex h-11 max-w-[calc(100vw-2rem)] items-center gap-2 overflow-hidden rounded-md px-3 text-xs text-fg-primary">
                <span aria-hidden="true" className="font-mono text-micro tabular-nums text-fg-secondary">
                  {current + 1}/{sections.length}
                </span>
                <span className="min-w-0 [overflow-wrap:break-word]">{sections[current]?.label}</span>
              </button>
            }
          >
            {sections.map((section, i) => (
              <DropdownMenuItem
                key={section.id}
                checked={i === current}
                shortcut={i === current ? <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : undefined}
                onClick={() => goTo(section.id)}
              >
                {section.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenu>
        </div>
      )}
    </>
  );
}
