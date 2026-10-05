/*
 * A progress bar (SLN-447): 4px tall, 2px radius, blue while reading and sage
 * when finished, on a `bg-tertiary` track. The number is always shown as text
 * nearby too; `label` is what a screen reader hears ("44 percent, page 212 of
 * 480").
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  tone = "blue",
  className = "",
}: {
  value: number;
  max?: number;
  label: string;
  tone?: "blue" | "sage";
  className?: string;
}) {
  const share = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={label}
      className={`h-1 w-full overflow-hidden rounded-sm bg-bg-tertiary ${className}`}
    >
      <div className={`h-full rounded-sm ${tone === "sage" ? "bg-accent-sage" : "bg-accent-blue"}`} style={{ width: `${share}%` }} />
    </div>
  );
}
