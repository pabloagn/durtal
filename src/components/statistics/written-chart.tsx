"use client";

import { useId, useState } from "react";
import { ChartFrame } from "@/components/reading/charts/chart-frame";
import { decadeBuckets, yearBuckets, yearLabel, type YearCountTuple } from "@/lib/statistics/charts";
import { n } from "@/lib/reading/charts";

/*
 * When the books were written (SLN-742), after Letterboxd's premiere dates:
 * a timeline of thin bars, one a year or one a decade, empty ones included,
 * shading from sage (the oldest) to blue (the newest), the first and last
 * year under it, and one tick at the tallest bar's count (SLN-1172). A chart
 * of the shared family (docs/03, Charts): one tab stop, arrow keys, the
 * caption line and "Show as table".
 */

const HEIGHT = 168;
const AXIS = 20;
/** Room over the tallest bar for its tick */
const TOP = 16;

const books = (count: number) => `${n(count)} ${count === 1 ? "book" : "books"}`;

export function WrittenChart({ years, height = HEIGHT }: { years: readonly YearCountTuple[]; height?: number }) {
  const [view, setView] = useState<"years" | "decades">("years");
  const gradient = useId();
  const counts = years.map(([year, count]) => ({ year, count }));
  const byYear = yearBuckets(counts);
  const bars = view === "years" ? byYear.bars : decadeBuckets(counts);
  if (!bars.length) return null;
  const max = Math.max(1, ...bars.map((b) => b.count));
  const unit = view === "years" ? "year" : "decade";
  const text = (b: (typeof bars)[number]) => `${b.start === null ? b.label : view === "years" ? b.label : `The ${b.label}`}: ${books(b.count)}`;
  const summary = `Books by the ${unit} they were written, ${bars[0].label} to ${bars[bars.length - 1].label}`;
  const total = bars.reduce((sum, b) => sum + b.count, 0);
  const plot = height - AXIS - TOP;

  return (
    <div className="space-y-3" data-stats-written="">
      <div role="group" aria-label="Show by" className="flex justify-end gap-1 pointer-coarse:gap-2">
        {(["years", "decades"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`inline-flex h-8 items-center rounded-sm border px-3 text-sm transition-colors pointer-coarse:h-11 ${
              view === v ? "border-accent-primary/10 bg-selection-bg/80 text-fg-primary" : "border-transparent text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary"
            }`}
          >
            {v === "years" ? "Years" : "Decades"}
          </button>
        ))}
      </div>
      <ChartFrame
        key={view}
        label={`Books by the ${unit} they were written`}
        brief={`${books(total)}, ${bars[0].label} to ${bars[bars.length - 1].label}`}
        points={bars.map((b) => ({ text: text(b) }))}
        height={height}
        table={{ columns: [view === "years" ? "Year" : "Decade", "Books"], rows: bars.filter((b) => b.count).map((b) => [b.label, b.count]) }}
        footnote={view === "years" && byYear.earlier ? `${books(byYear.earlier)} written before ${yearLabel(byYear.from!)} ${byYear.earlier === 1 ? "is" : "are"} in the Decades view.` : undefined}
      >
        {(width, focus) => {
          const band = width / bars.length;
          const barWidth = Math.max(1, Math.min(24, band * (view === "years" ? 0.55 : 0.7)));
          return (
            <svg role="img" aria-label={summary} width={width} height={height} className="block overflow-visible" data-chart-svg="">
              <defs>
                <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1={0} x2={width} y1={0} y2={0}>
                  <stop offset="0" stopColor="var(--color-accent-sage)" />
                  <stop offset="1" stopColor="var(--color-accent-blue)" />
                </linearGradient>
              </defs>
              <line x1={0} x2={width} y1={TOP + 0.5} y2={TOP + 0.5} className="stroke-glass-border" strokeWidth={1} data-written-top="" />
              <text x={0} y={TOP - 5} className="fill-fg-secondary text-micro tabular-nums" data-written-max="">
                {n(max)}
              </text>
              <line x1={0} x2={width} y1={TOP + plot + 0.5} y2={TOP + plot + 0.5} className="stroke-glass-border" strokeWidth={1} />
              {bars.map((b, i) => {
                const h = (b.count / max) * plot;
                const x = i * band + (band - barWidth) / 2;
                return (
                  <g key={b.label}>
                    {/* The whole band answers hover, so a 1px bar is easy to point at */}
                    <rect x={i * band} y={TOP} width={band} height={plot} fill="transparent" data-tooltip={text(b)} />
                    {b.count > 0 && <rect x={x} y={TOP + plot - h} width={barWidth} height={Math.max(2, h)} rx={Math.min(1, barWidth / 2)} fill={`url(#${gradient})`} pointerEvents="none" />}
                    {focus === i && (
                      <rect x={x - 3} y={TOP - 3} width={barWidth + 6} height={plot + 6} rx={2} fill="none" stroke="var(--color-accent-primary)" strokeWidth={1.5} />
                    )}
                  </g>
                );
              })}
              <text x={0} y={height - 5} className="fill-fg-secondary text-micro tabular-nums">
                {bars[0].label}
              </text>
              <text x={width} y={height - 5} textAnchor="end" className="fill-fg-secondary text-micro tabular-nums">
                {bars[bars.length - 1].label}
              </text>
            </svg>
          );
        }}
      </ChartFrame>
    </div>
  );
}
