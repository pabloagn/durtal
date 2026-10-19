import { n } from "@/lib/reading/charts";
import { percentOf } from "@/lib/statistics/charts";

/*
 * A two-way split as a ring (SLN-742), after Letterboxd's breakdown pies:
 * the first part in sage over a slate track, its share written in the
 * middle, and both parts written out under it. Every value is text, so the
 * ring itself is decoration. The figure is named once, with the share
 * ("Read: 52%, 2,151 of 4,167"); what it shows is hidden from assistive
 * technology so nothing is read twice (SLN-1172).
 */

const SIZE = 112;
const STROKE = 12;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function SplitRing({ title, first, second }: { title: string; first: { label: string; value: number }; second: { label: string; value: number } }) {
  const total = first.value + second.value;
  if (!total) return null;
  const share = percentOf(first.value, total);
  const arc = (first.value / total) * CIRCUMFERENCE;
  return (
    <figure
      className="flex min-w-0 flex-col items-center gap-3"
      aria-label={`${title}: ${share}%, ${n(first.value)} of ${n(total)}`}
      data-stats-ring={title}
    >
      <div aria-hidden className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="block -rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} className="stroke-accent-slate/45" />
          {first.value > 0 && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              strokeDasharray={`${arc} ${CIRCUMFERENCE}`}
              className="stroke-accent-sage"
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-serif text-lg text-fg-primary tabular-nums">{share}%</span>
      </div>
      <figcaption aria-hidden className="w-full text-center">
        <span className="block type-caption">{title}</span>
        <span className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-xs text-fg-secondary">
          {[
            { ...first, swatch: "bg-accent-sage" },
            { ...second, swatch: "bg-accent-slate/45" },
          ].map((part) => (
            <span key={part.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className={`h-2 w-2 shrink-0 rounded-[2px] ${part.swatch}`} />
              {part.label} <span className="text-fg-primary tabular-nums">{n(part.value)}</span>
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}
