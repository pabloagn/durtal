"use client";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  /** Names the switch when no visible label does */
  "aria-label"?: string;
  /** The id of the text that names the switch */
  "aria-labelledby"?: string;
  /** The id of the text that explains the switch */
  "aria-describedby"?: string;
}

/**
 * An on/off control, squared like every control (2px radius). On, the track
 * fills rose and the knob moves right. Space and Enter toggle it.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  ...aria
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      {...aria}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-sm border transition-colors touch-hit duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked
          ? "border-accent-rose bg-accent-rose/90"
          : "border-glass-border bg-bg-tertiary hover:border-fg-muted/30"
      }`}
    >
      <span
        aria-hidden
        className={`block h-3 w-3 rounded-[1px] transition-transform duration-150 ${
          checked
            ? "translate-x-[19px] bg-fg-primary"
            : "translate-x-[3px] bg-fg-secondary"
        }`}
      />
    </button>
  );
}
