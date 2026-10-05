"use client";

import { X } from "lucide-react";

export interface ActiveFilterChip {
  /** The URL key the chip removes */
  key: string;
  /** The value it removes; none: the whole key (a range) */
  value?: string;
  /** "Language" */
  group: string;
  /** "French" */
  label: string;
  /** A colour's swatch */
  swatch?: string;
}

/**
 * The filters a list has, one chip each under its filter bar (SLN-405): a
 * click on a chip removes that filter; "Clear all" removes every one. Nothing
 * when no filter is set.
 */
export function ActiveFilters({
  chips,
  onRemove,
  onClearAll,
}: {
  chips: ActiveFilterChip[];
  onRemove: (chip: ActiveFilterChip) => void;
  onClearAll: () => void;
}) {
  if (!chips.length) return null;
  return (
    <div role="group" aria-label="Active filters" className="mt-3 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={`${chip.key}:${chip.value ?? ""}`}
          type="button"
          onClick={() => onRemove(chip)}
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm border border-glass-border bg-bg-secondary pl-2 pr-1.5 text-xs transition-colors hover:bg-bg-tertiary pointer-coarse:h-11"
        >
          <span className="sr-only">Remove filter: </span>
          {chip.swatch && (
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm border border-glass-border"
              style={{ backgroundColor: chip.swatch }}
            />
          )}
          <span className="shrink-0 text-fg-secondary">{chip.group}</span>
          <span className="truncate text-fg-primary">{chip.label}</span>
          <X aria-hidden className="h-3 w-3 shrink-0 text-fg-secondary" strokeWidth={1.5} />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="inline-flex h-7 items-center px-1.5 text-xs text-accent-rose-text transition-colors hover:text-accent-rose-text/80 pointer-coarse:h-11"
      >
        Clear all
      </button>
    </div>
  );
}
