"use client";

import { useId, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";

/**
 * The review queue's filters. On a phone the search field shares its row with
 * Filter, which opens the language, format and ISBN choices and Apply under
 * it, so the queue starts near the top of the first screen. From `sm` up
 * every field is in the form's grid, as before.
 */
export function ReviewFilters({ search, filters, active }: {
  search: ReactNode;
  /** The choices and Apply, each a cell of the form's grid from `sm` up */
  filters: ReactNode;
  /** How many choices are set, shown on Filter */
  active: number;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <>
      <div className="flex items-end gap-2 sm:contents">
        {/* With Apply hidden on a phone, a browser does not submit on Enter itself */}
        <div className="min-w-0 flex-1 sm:contents" onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
          event.preventDefault();
          event.target.form?.requestSubmit();
        }}>{search}</div>
        {/* Outlined like the Filter of every other list */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen((value) => !value)}
          className={`flex h-8 shrink-0 items-center gap-1.5 rounded-sm border px-2.5 text-xs transition-colors pointer-coarse:h-11 sm:hidden ${
            active > 0
              ? "border-accent-primary/40 bg-selection-bg/20 text-fg-primary"
              : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          Filter
          {active > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-selection-bg text-micro font-medium leading-none text-fg-primary">
              {active}
            </span>
          )}
        </button>
      </div>
      <div id={panel} className={`${open ? "grid" : "hidden"} gap-3 sm:contents`}>{filters}</div>
    </>
  );
}
