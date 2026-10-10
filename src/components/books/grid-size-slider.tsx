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
  const feedback =
    layout?.items === 0
      ? "No cards"
      : layout
        ? `${layout.columns} per row${compact && layout.width < 328 ? " · narrow space" : ""}`
        : compact
          ? "Compact"
          : "Large";
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
      <div className="grid-size-mobile">
        <div className="flex items-center gap-2">
          <span className="text-micro text-fg-secondary">Large</span>
          <input
            type="range"
            aria-label="Card size: Large or Compact"
            aria-valuetext={compact ? "Compact" : "Large"}
            min={0}
            max={1}
            value={compact ? 1 : 0}
            onChange={(e) =>
              onChange(mobileGridPreference(value, e.target.value === "1"))
            }
            className={rangeClass}
          />
          <span className="text-micro text-fg-secondary">Compact</span>
        </div>
        <output
          aria-live="polite"
          className="block min-h-[2lh] max-w-52 text-micro text-fg-secondary"
        >
          {feedback}
        </output>
      </div>
    </div>
  );
}
