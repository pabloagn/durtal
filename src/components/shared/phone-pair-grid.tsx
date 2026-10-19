import { Children, type ReactNode } from "react";

/** The column counts `catalogue-grid` makes on the dashboard: one under 432px, up to six at 1328px */
const COLUMNS = [2, 3, 4, 5, 6] as const;

/**
 * For each column count, how many cards would sit alone on a last, partial
 * row: `data-rem-5="3"` hides the last three cards when the grid has five
 * columns (`full-rows` in globals.css). A shelf no longer than one row keeps
 * all its cards.
 */
export function fullRowAttributes(count: number): Record<string, number> {
  return Object.fromEntries(
    COLUMNS.filter((columns) => count > columns && count % columns > 0).map((columns) => [`data-rem-${columns}`, count % columns]),
  );
}

/**
 * A card grid that keeps two cards a row on a phone (SLN-642), as the
 * library's Compact size does (`catalogue-density-compact` in globals.css):
 * on a touch screen up to 767px wide, a container of 328px or more holds two
 * columns with an 8px gap and tighter card padding. Elsewhere it is the
 * ordinary `catalogue-grid`, whose 208px readable minimum would leave one
 * full-width card per row on a phone.
 *
 * A shelf ends on a full row: the cards that would sit alone on a last row
 * are left out, at whatever column count the width gives (the dashboard).
 * A record of everything, such as a person's credits, passes
 * `endOnFullRow={false}` and keeps every card (SLN-1019).
 */
export function PhonePairGrid({ children, endOnFullRow = true }: { children: ReactNode; endOnFullRow?: boolean }) {
  return (
    <div className="@container">
      <div
        className={`catalogue-grid catalogue-density-compact${endOnFullRow ? " full-rows" : ""}`}
        {...(endOnFullRow ? fullRowAttributes(Children.toArray(children).length) : {})}
      >
        {children}
      </div>
    </div>
  );
}
