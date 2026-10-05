"use client";

import { niceMax, ticks } from "@/lib/reading/charts";
import { ChartFrame } from "./chart-frame";

/*
 * Bars (SLN-456): vertical where there is room, horizontal under 480px of
 * width. Drawn at the measured width with unscaled 12px text; one height for
 * both, so nothing moves when the chart measures itself.
 */

export interface Bar {
  /** The label under or beside the bar: "Jan", "4.5", "Sunday" */
  label: string;
  value: number;
  /** The caption for this bar: "January 2026: 4 books" */
  text: string;
}

const NARROW = 480;
const ROW = 18;
/** Half the cap height of 12px Inter: a label's baseline this far below a mark's center puts its capitals on that center */
export const CAP_HALF = 4.36;

export function barChartHeight(count: number) {
  return Math.max(160, count * ROW + 8);
}

export function BarChart({
  label,
  bars,
  summaryUnit,
  tone = "sage",
  footnote,
  columns,
  minRows = 0,
}: {
  label: string;
  bars: Bar[];
  /** "books": the summary reads "Books by month: Jan 2 books, ..." */
  summaryUnit: string;
  tone?: "sage" | "blue";
  footnote?: React.ReactNode;
  /** The table's two column names */
  columns: [string, string];
  /** Charts side by side take the height of the one with the most bars */
  minRows?: number;
}) {
  const max = Math.max(0, ...bars.map((b) => b.value));
  const top = niceMax(max);
  const height = barChartHeight(Math.max(bars.length, minRows));
  const summary = `${label}: ${bars.map((b) => `${b.label} ${b.value.toLocaleString("en-US")}`).join(", ")} ${summaryUnit}`;
  const fill = tone === "sage" ? "fill-accent-sage" : "fill-accent-blue";
  return (
    <ChartFrame
      label={label}
      summary={summary}
      points={bars.map((b) => ({ text: b.text }))}
      height={height}
      footnote={footnote}
      table={{ columns, rows: bars.map((b) => [b.label, b.value]) }}
    >
      {(width, focus) =>
        width < NARROW ? (
          <svg role="img" aria-label={summary} width={width} height={height} className="block overflow-visible" data-chart-svg="">
            {bars.map((b, i) => {
              const labelWidth = 72;
              const room = Math.max(0, width - labelWidth - 48);
              const w = top ? (b.value / top) * room : 0;
              const y = 4 + i * ROW;
              return (
                <g key={i}>
                  <text x={labelWidth - 6} y={y + ROW / 2 + CAP_HALF} textAnchor="end" className="fill-fg-secondary text-micro">
                    {b.label}
                  </text>
                  <rect x={labelWidth} y={y + 3} width={room} height={ROW - 6} rx={2} className="fill-bg-tertiary" />
                  <rect
                    x={labelWidth}
                    y={y + 3}
                    width={Math.max(b.value > 0 ? 2 : 0, w)}
                    height={ROW - 6}
                    rx={2}
                    className={fill}
                    data-tooltip={b.text}
                  />
                  {focus === i && <rect x={labelWidth - 2} y={y + 1} width={room + 4} height={ROW - 2} rx={2} fill="none" stroke="var(--color-accent-rose)" strokeWidth={1.5} />}
                  <text x={labelWidth + w + 6} y={y + ROW / 2 + CAP_HALF} className="fill-fg-secondary text-micro tabular-nums">
                    {b.value.toLocaleString("en-US")}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <svg role="img" aria-label={summary} width={width} height={height} className="block overflow-visible" data-chart-svg="">
            {(() => {
              const left = 36;
              const bottom = 20;
              const plot = height - bottom - 6;
              const band = (width - left) / bars.length;
              const barWidth = Math.min(40, band * 0.6);
              return (
                <>
                  {ticks(max).map((t) => {
                    const y = 6 + plot - (t / top) * plot;
                    return (
                      <g key={t}>
                        <line x1={left} x2={width} y1={y} y2={y} className="stroke-glass-border" strokeWidth={1} />
                        <text x={left - 6} y={y + CAP_HALF} textAnchor="end" className="fill-fg-secondary text-micro tabular-nums">
                          {t.toLocaleString("en-US")}
                        </text>
                      </g>
                    );
                  })}
                  {bars.map((b, i) => {
                    const h = top ? (b.value / top) * plot : 0;
                    const x = left + i * band + (band - barWidth) / 2;
                    return (
                      <g key={i}>
                        <rect x={x} y={6 + plot - h} width={barWidth} height={Math.max(b.value > 0 ? 2 : 0, h)} rx={2} className={fill} data-tooltip={b.text} />
                        {focus === i && (
                          <rect x={x - 3} y={4} width={barWidth + 6} height={plot + 4} rx={2} fill="none" stroke="var(--color-accent-rose)" strokeWidth={1.5} />
                        )}
                        <text x={x + barWidth / 2} y={height - 5} textAnchor="middle" className="fill-fg-secondary text-micro">
                          {b.label}
                        </text>
                      </g>
                    );
                  })}
                </>
              );
            })()}
          </svg>
        )
      }
    </ChartFrame>
  );
}
