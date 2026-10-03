"use client";

import type { LucideIcon } from "lucide-react";

/**
 * Replaces a field's text as if it was typed, so Cmd+Z undoes it and React
 * gets a normal change event. `fallback` sets the value where the browser
 * refuses the edit command.
 */
export function replaceFieldText(
  input: HTMLInputElement | null,
  text: string,
  fallback: (text: string) => void,
) {
  if (!input) return fallback(text);
  input.focus();
  input.select();
  if (!document.execCommand("insertText", false, text)) fallback(text);
}

/**
 * A small button inside a field, for a fix of the field's text. Soft gold
 * when it can act, muted gray when there is nothing to fix. ⌥F presses it
 * from the field (see the keyboard shortcuts).
 */
export function FieldActionButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-field-action=""
      data-active={active || undefined}
      // Keeps the focus in the field; Tab skips the button (⌥F presses it)
      onMouseDown={(e) => e.preventDefault()}
      tabIndex={-1}
      onClick={active ? onClick : undefined}
      disabled={disabled}
      aria-disabled={!active}
      aria-label={label}
      title={`${label} (⌥F)`}
      className="flex h-6 w-6 cursor-default items-center justify-center rounded-sm text-fg-muted transition-colors duration-150 disabled:opacity-40 data-[active]:cursor-pointer data-[active]:text-accent-gold/85 data-[active]:hover:bg-accent-gold/10 data-[active]:hover:text-accent-gold"
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
    </button>
  );
}
