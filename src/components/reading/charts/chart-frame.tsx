"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { moveFocus } from "@/lib/reading/charts";

/*
 * The frame every reading chart sits in (SLN-456): one tab stop (a group
 * named after the chart), arrow keys moving a focus point (Left and Right by
 * one, Up and Down by `step`, Home and End), the focused value in a caption
 * line and a polite live region, and "Show as table". It measures its width
 * with a ResizeObserver; the chart's height is fixed, so nothing shifts.
 */

export interface ChartPoint {
  /** What the caption and the live region say for this point: "March 2026: 4 books" */
  text: string;
}

export function ChartFrame({
  label,
  summary,
  points,
  step = 1,
  height,
  footnote,
  table,
  children,
}: {
  /** Names the chart: "Books by month" */
  label: string;
  /** The whole chart in words, for the SVG's aria-label and the caption before a point is chosen */
  summary: string;
  points: ChartPoint[];
  /** How far Up and Down move: 7 in the calendar */
  step?: number;
  height: number;
  footnote?: ReactNode;
  /** The same data as a table */
  table: { columns: string[]; rows: (string | number)[][] };
  /** Draws the chart at a width, with the focused point (or none) */
  children: (width: number, focus: number | null) => ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  // Keys can come faster than renders: each moves from the last key's point
  const at = useRef<number | null>(null);
  const [said, setSaid] = useState("");
  const [showTable, setShowTable] = useState(false);
  const captionId = useId();
  const tableId = useId();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    const next = moveFocus(at.current, e.key, points.length, step);
    if (next === null) return;
    e.preventDefault();
    at.current = next;
    setFocus(next);
    setSaid(points[next].text);
  }

  const caption = focus !== null ? points[focus]?.text : summary;
  return (
    <figure className="min-w-0" data-chart={label}>
      <div
        ref={box}
        tabIndex={0}
        role="group"
        aria-label={label}
        aria-describedby={captionId}
        onKeyDown={onKeyDown}
        onBlur={() => {
          at.current = null;
          setFocus(null);
        }}
        className="rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent-rose/60"
        style={{ height }}
        data-chart-frame=""
      >
        {width > 0 && children(width, focus)}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <p id={captionId} className="min-h-4 text-xs text-fg-secondary" data-chart-caption="">
          {caption}
        </p>
        <button
          type="button"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable(!showTable)}
          className="text-xs text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline pointer-coarse:min-h-11"
          data-chart-table-toggle=""
        >
          {showTable ? "Hide table" : "Show as table"}
        </button>
      </figcaption>
      <p className="sr-only" aria-live="polite" data-chart-live="">
        {said}
      </p>
      {footnote && <p className="mt-1 text-xs text-fg-secondary">{footnote}</p>}
      <div id={tableId} hidden={!showTable}>
        {showTable && (
          <table className="mt-3 w-full text-left text-xs" data-chart-table="">
            <thead>
              <tr className="border-b border-glass-border text-fg-secondary">
                {table.columns.map((c) => (
                  <th key={c} scope="col" className="py-1.5 pr-4 font-normal">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i} className="border-b border-glass-border/50 text-fg-primary">
                  {row.map((cell, k) => (
                    <td key={k} className="py-1.5 pr-4 tabular-nums">
                      {typeof cell === "number" ? cell.toLocaleString("en-US") : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </figure>
  );
}
