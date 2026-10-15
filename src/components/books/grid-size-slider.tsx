"use client";

import { useEffect, useRef, useState } from "react";

interface GridSizeSliderProps {
  value: number;
  onChange: (cols: number) => void;
}

/** Project only the displayed control, never write a cookie on resize. */
export function mobileGridPreference(current: number, compact: boolean) {
  return compact ? Math.max(3, current) : 2;
}

export function GridSizeSlider({ value, onChange }: GridSizeSliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{
    columns: number;
    width: number;
    items: number;
  } | null>(null);
  useEffect(() => {
    let grid: HTMLElement | null = null;
    const resize = new ResizeObserver(measure);
    function measure() {
      let found: HTMLElement | null = null;
      // The nearest common section owns this control and its grid. Filters
      // may sit outside a Suspense boundary, so attach again when it arrives.
      for (
        let section = ref.current?.parentElement;
        section && !found;
        section = section.parentElement
      ) {
        found = section.querySelector<HTMLElement>("[data-catalogue-grid]");
      }
      if (found !== grid) {
        resize.disconnect();
        grid = found;
        if (grid) resize.observe(grid);
      }
      if (!grid) {
        setLayout((current) => (current === null ? current : null));
        return;
      }
      const next = {
        columns: getComputedStyle(grid)
          .gridTemplateColumns.split(" ")
          .filter(Boolean).length,
        width: Math.round(grid.getBoundingClientRect().width),
        items: grid.children.length,
      };
      setLayout((current) =>
        current?.columns === next.columns &&
        current.width === next.width &&
        current.items === next.items
          ? current
          : next,
      );
    }
    const mutation = new MutationObserver(measure);
    const main = ref.current?.closest("main") ?? ref.current?.parentElement;
    if (main)
      mutation.observe(main, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-grid-density", "data-catalogue-view"],
      });
    const pointer = matchMedia("(pointer: coarse)");
    pointer.addEventListener("change", measure);
    measure();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      pointer.removeEventListener("change", measure);
    };
  }, [value]);

  const compact = value > 2;
  // On a phone the line beside the slider names the size, so the slider
  // needs no labels at its ends and fits beside the views (SLN-641). Every
  // list draws it as one row, the slider then its line (SLN-804)
  const size = compact ? "Compact" : "Large";
  // The line never wraps or pushes the slider under 44px: "Compact" alone
  // needs a 7.5rem box (about 55px, the 12px gap and the slider's 44px; a
  // narrower box takes a row of its own, globals.css), the count a 12rem one
  // ("Compact · 2 per row" is about 118px), the narrow-space note a 17rem
  // one (the whole line is about 205px)
  const count =
    layout?.items === 0
      ? " · no cards"
      : layout
        ? ` · ${layout.columns} per row`
        : "";
  const narrow =
    layout && layout.items > 0 && compact && layout.width < 328
      ? " · narrow space"
      : "";
  const rangeClass =
    "h-1 w-20 cursor-pointer appearance-none rounded-full bg-bg-tertiary accent-accent-primary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-primary pointer-coarse:h-11 pointer-coarse:rounded-none pointer-coarse:bg-transparent pointer-coarse:bg-[linear-gradient(var(--color-bg-tertiary),var(--color-bg-tertiary))] pointer-coarse:bg-[length:100%_4px] pointer-coarse:bg-center pointer-coarse:bg-no-repeat";
  return (
    <div ref={ref} className="grid-size-slider">
      <div className="grid-size-desktop flex items-center gap-2">
        <span className="text-micro text-fg-secondary">Size</span>
        <input
          type="range"
          aria-label="Grid size: cards per row"
          min={2}
          max={8}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className={rangeClass}
        />
      </div>
      <div className="grid-size-mobile @container">
        <div className="flex items-center gap-3">
          <input
            type="range"
            aria-label="Card size: Large or Compact"
            aria-valuetext={size}
            min={0}
            max={1}
            value={compact ? 1 : 0}
            onChange={(e) =>
              onChange(mobileGridPreference(value, e.target.value === "1"))
            }
            className="card-size-range min-w-11 flex-1"
          />
          <output aria-live="polite" className="block whitespace-nowrap text-micro text-fg-secondary">
            {size}
            {count && <span className="hidden @min-[12rem]:inline">{count}</span>}
            {narrow && <span className="hidden @min-[17rem]:inline">{narrow}</span>}
          </output>
        </div>
      </div>
    </div>
  );
}
