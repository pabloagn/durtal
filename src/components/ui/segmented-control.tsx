"use client";

import { useRef } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group when no visible label does */
  ariaLabel?: string;
  /** The id of the text that names the group */
  ariaLabelledby?: string;
  disabled?: boolean;
}

/**
 * One choice from a few, all in view: a row of buttons where the chosen one
 * is filled. A radio group for assistive technology: Tab enters at the
 * chosen button, and the arrow keys move the choice.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  ariaLabelledby,
  disabled,
}: SegmentedControlProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = options.findIndex((option) => option.value === value);

  function move(from: number, step: number) {
    const next = (from + step + options.length) % options.length;
    onChange(options[next].value);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      className="flex flex-wrap gap-1"
    >
      {options.map((option, index) => {
        const active = index === chosen;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // One stop for Tab: the chosen button, or the first one
            tabIndex={active || (chosen < 0 && index === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(index, -1);
              }
            }}
            className={`h-8 rounded-sm border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? "border-accent-rose/40 bg-accent-plum text-fg-primary"
                : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
