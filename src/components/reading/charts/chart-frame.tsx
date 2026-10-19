"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { moveFocus } from "@/lib/reading/charts";

/*
 * The frame every reading chart sits in (SLN-456): one tab stop (a group
 * named after the chart), arrow keys moving a focus point (Left and Right by
 * one, Up and Down by `step`, Home and End), the focused value in a caption
 * line and a polite live region, and "Show as table". It measures its width
 * with a ResizeObserver; the chart's height is fixed, so nothing shifts.
 * The whole chart in words is said once, by the SVG (SLN-1172): the caption
 * shows a short line until a point has focus, and the figure is named by the
 * visible title, or by the label when there is none.
 */

export interface ChartPoint {
  /** What the caption and the live region say for this point: "March 2026: 4 books" */
  text: string;
}

export function ChartFrame({
  label,
  title,
  brief,
  points,
  step = 1,
  height,
  footnote,
  table,
  children,
}: {
  /** Names the chart: "Books by month" */
  label: string;
  /** A visible title over the chart, which then names the figure: "Books finished" */
  title?: string;
  /** The caption before a point is chosen: a total and a peak, or the label when there is none */
  brief?: string;
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
  const titleId = useId();
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

  const caption = focus !== null ? points[focus]?.text : (brief ?? label);
  return (
    <figure className="min-w-0" data-chart={label} {...(title ? { "aria-labelledby": titleId } : { "aria-label": label })}>
      {title && (
        // Hidden from assistive technology: it names the figure, so it is said there once
        <p id={titleId} aria-hidden className="mb-3 type-caption" data-chart-title="">
          {title}
        </p>
      )}
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
        // The house outline, held clear of the axis labels at the frame's edges
        className="rounded-sm focus-visible:outline-offset-4"
        style={{ height }}
        data-chart-frame=""
      >
        {width > 0 && children(width, focus)}
      </div>
      {/* A blur replaces the focused value with the short line. Keep the
          toggle in its own column so that change cannot move its hit area. */}
      <figcaption className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1">
        <p id={captionId} className="min-h-4 min-w-0 break-words text-xs text-fg-secondary" data-chart-caption="">
          {caption}
        </p>
        <button
          type="button"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable(!showTable)}
          className="justify-self-end whitespace-nowrap text-xs text-command pointer-coarse:my-0 pointer-coarse:min-h-11 pointer-coarse:py-0"
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
