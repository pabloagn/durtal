"use client";
import {
  ANNOTATION_COLORS,
  type AnnotationColor,
} from "@/lib/reader/annotations";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import { shortcutProps } from "@/lib/shortcuts/shortcuts";

export function AnnotationSwatches({
  color,
  onPick,
  disabled,
  fills = QUIET_GLASS_ANNOTATION_PALETTE.fills,
}: {
  color?: AnnotationColor | null;
  onPick(color: AnnotationColor): void;
  disabled?: boolean;
  fills?: Record<AnnotationColor, string>;
}) {
  return (
    <div
      role="group"
      aria-label="Highlight colour"
      className="flex flex-wrap gap-1"
    >
      {ANNOTATION_COLORS.map((item, index) => (
        <button
          key={item}
          type="button"
          aria-label={`Highlight in ${item}`}
          aria-pressed={color === item}
          data-tooltip={`Highlight in ${item}`}
          {...shortcutProps(String(index + 1))}
          disabled={disabled}
          onClick={() => onPick(item)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm hover:bg-bg-tertiary focus-visible:outline focus-visible:outline-accent-primary disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <span
            aria-hidden
            className={`block h-4 w-4 rounded-full border ${color === item ? "border-fg-primary" : "border-glass-border"}`}
            style={{ backgroundColor: fills[item] }}
          />
        </button>
      ))}
    </div>
  );
}
