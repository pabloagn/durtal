import type { ReactNode } from "react";

/**
 * A card grid that keeps two cards a row on a phone (SLN-642), as the
 * library's Compact size does (`catalogue-density-compact` in globals.css):
 * on a touch screen up to 767px wide, a container of 328px or more holds two
 * columns with an 8px gap and tighter card padding. Elsewhere it is the
 * ordinary `catalogue-grid`, whose 208px readable minimum would leave one
 * full-width card per row on a phone.
 */
export function PhonePairGrid({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="catalogue-grid catalogue-density-compact">{children}</div>
    </div>
  );
}
