"use client";

import { useRef, useSyncExternalStore } from "react";
import { READER_FONTS, readerFontPreviewCSS } from "@/lib/reader/presentation/fonts";
import type { ReaderPresentation } from "@/lib/validations/reader-preferences";

type Font = ReaderPresentation["font"];
const FONTS = Object.values(READER_FONTS);
const noSubscribe = () => () => {};

/**
 * The reading fonts, each name set in its own face: a radio group like
 * SegmentedControl (Tab enters at the chosen font, arrows move the choice).
 * Only each family's Latin roman file loads for its name.
 */
export function FontPicker({
  value,
  onChange,
  labelledBy,
}: {
  value: Font;
  onChange(font: Font): void;
  labelledBy: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => null);
  const chosen = FONTS.findIndex((font) => font.id === value);
  const move = (from: number, step: number) => {
    const next = (from + step + FONTS.length) % FONTS.length;
    onChange(FONTS[next].id);
    buttons.current[next]?.focus();
  };
  return (
    <>
      {origin && <style>{readerFontPreviewCSS(origin)}</style>}
      {/* Every row as tall as the tallest: "Atkinson Hyperlegible" takes two lines in
          full, and the grid stays even around it (SLN-892) */}
      <div role="radiogroup" aria-labelledby={labelledBy} className="grid auto-rows-fr grid-cols-2 gap-1">
        {FONTS.map((font, index) => {
          const active = index === chosen;
          return (
            <button
              key={font.id}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active || (chosen < 0 && index === 0) ? 0 : -1}
              onClick={() => onChange(font.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  move(index, 1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  move(index, -1);
                }
              }}
              style={font.family ? { fontFamily: `"${font.family}", ${font.fallback}` } : undefined}
              className={`min-h-10 rounded-sm border px-3 py-1.5 text-left text-base leading-snug transition-colors pointer-coarse:min-h-11 ${
                active
                  ? "border-accent-primary/40 bg-selection-bg text-fg-primary"
                  : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
              }`}
            >
              {font.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
