"use client";

import { useEffect, useRef } from "react";
import { calendarBlocks, calendarCells, dayLabel, minutesLabel, MONTHS_SHORT, shade, WEEKDAYS } from "@/lib/reading/charts";
import { CAP_HALF } from "./bar-chart";
import { ChartFrame } from "./chart-frame";

/*
 * The reading days of a year (SLN-456): week rows starting on the reading
 * week's first day, in four blocks side by side, shaded by minutes read (or
 * pages when nothing was timed). Up and Down move a week, Left and Right a
 * day. Under 600px it scrolls inside its own box, never the page.
 */

const CELL = 12;
const GAP = 2;
const LABEL = 28;
const HEAD = 16;
const BLOCK_GAP = 16;
const SHADES = ["fill-bg-tertiary", "fill-accent-sage/30", "fill-accent-sage/55", "fill-accent-sage/80", "fill-accent-sage"];

export function CalendarHeatmap({
  year,
  weekStart,
  days,
}: {
  year: number;
  weekStart: 1 | 7;
  days: { day: string; minutes: number; pages: number }[];
}) {
  const cells = calendarCells(year, weekStart);
  const byDay = new Map(days.map((d) => [d.day, d]));
  const timed = days.some((d) => d.minutes > 0);
  const amount = (day: string) => (timed ? (byDay.get(day)?.minutes ?? 0) : (byDay.get(day)?.pages ?? 0));
  const max = Math.max(0, ...cells.map((c) => amount(c.day)));
  const rows = cells.at(-1)!.row + 1;
  const blocks = calendarBlocks(rows);
  const blockWidth = LABEL + 7 * (CELL + GAP);
  const width = blocks.length * blockWidth + (blocks.length - 1) * BLOCK_GAP;
  const height = HEAD + Math.ceil(rows / blocks.length) * (CELL + GAP);
  const read = days.length;
  const summary = `Reading days in ${year}: ${read} ${read === 1 ? "day" : "days"}${timed ? `, ${minutesLabel(days.reduce((s, d) => s + d.minutes, 0))}` : ""}`;
  const text = (day: string) => {
    const d = byDay.get(day);
    if (!d) return `${dayLabel(day)}: no reading`;
    const parts = [d.minutes ? minutesLabel(d.minutes) : null, d.pages ? `${d.pages.toLocaleString("en-US")} pages` : null].filter(Boolean);
    return `${dayLabel(day)}: ${parts.join(", ") || "read"}`;
  };
  const order = weekStart === 1 ? [0, 1, 2, 3, 4, 5, 6] : [6, 0, 1, 2, 3, 4, 5];

  return (
    <ChartFrame
      label={`Reading days in ${year}`}
      summary={summary}
      points={cells.map((c) => ({ text: text(c.day) }))}
      step={7}
      height={height + 12}
      table={{ columns: ["Day", "Minutes", "Pages"], rows: days.map((d) => [dayLabel(d.day), Math.round(d.minutes), d.pages]) }}
    >
      {(_, focus) => <Grid cells={cells} blocks={blocks} width={width} height={height} focus={focus} summary={summary} amount={amount} max={max} text={text} order={order} blockWidth={blockWidth} />}
    </ChartFrame>
  );
}

function Grid({
  cells,
  blocks,
  width,
  height,
  focus,
  summary,
  amount,
  max,
  text,
  order,
  blockWidth,
}: {
  cells: ReturnType<typeof calendarCells>;
  blocks: { from: number; to: number }[];
  width: number;
  height: number;
  focus: number | null;
  summary: string;
  amount: (day: string) => number;
  max: number;
  text: (day: string) => string;
  order: number[];
  blockWidth: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Keep the focused day in view when the box scrolls
  useEffect(() => {
    if (focus === null) return;
    const el = scroller.current?.querySelector<SVGRectElement>(`[data-cal-index="${focus}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus]);
  const blockOf = (row: number) => blocks.findIndex((b) => row >= b.from && row <= b.to);
  return (
    <div ref={scroller} tabIndex={-1} className="overflow-x-auto outline-none overflow-y-hidden [scrollbar-width:thin]" style={{ height: height + 12 }}>
      <svg role="img" aria-label={summary} width={width} height={height} className="block" data-chart-svg="">
        {blocks.map((b, k) => (
          <g key={k} transform={`translate(${k * (blockWidth + BLOCK_GAP)}, 0)`}>
            {order.map((w, i) => (
              <text key={i} x={LABEL + i * (CELL + GAP) + CELL / 2} y={11} textAnchor="middle" className="fill-fg-secondary text-micro">
                {WEEKDAYS[w].slice(0, 1)}
              </text>
            ))}
          </g>
        ))}
        {cells.map((c) => {
          const k = blockOf(c.row);
          const x = k * (blockWidth + BLOCK_GAP) + LABEL + c.column * (CELL + GAP);
          const y = HEAD + (c.row - blocks[k].from) * (CELL + GAP);
          const first = c.day.endsWith("-01");
          return (
            <g key={c.day}>
              {first && (
                <text x={k * (blockWidth + BLOCK_GAP)} y={y + CELL / 2 + CAP_HALF} className="fill-fg-secondary text-micro">
                  {MONTHS_SHORT[Number(c.day.slice(5, 7)) - 1]}
                </text>
              )}
              <rect
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx={2}
                className={SHADES[shade(amount(c.day), max)]}
                stroke={focus === c.index ? "var(--color-accent-rose)" : first ? "var(--color-fg-muted)" : "none"}
                strokeWidth={focus === c.index ? 2 : first ? 0.5 : 0}
                data-tooltip={text(c.day)}
                data-cal-index={c.index}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
