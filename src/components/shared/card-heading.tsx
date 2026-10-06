import type { ReactNode } from "react";
import { CapAligned } from "./cap-aligned";

/**
 * The title of a card and the text under it (author, nationality, original
 * title, description), kept together at the top of the card's text.
 *
 * The block always takes two title lines and `subtitleLines` lines of
 * subtitle, so cards of one kind keep one height. A one-line title leaves its
 * free line below the subtitle, above the card's info row: the subtitle sits
 * 4px under the last line of the title on every card.
 *
 * How it works: an invisible copy with the fixed-height `lines-*` boxes
 * reserves the space; the visible title and subtitle share its grid cell and
 * take only the lines they need.
 *
 * `action` (the favourite star) sits at the end of the title's first line,
 * on its cap-height center, above a card-wide link (`z-20`).
 */
export function CardHeading({
  title,
  icon,
  subtitle,
  subtitleLines = 1,
  subtitleClassName = "text-sm text-fg-secondary",
  titleClassName = "",
  action,
}: {
  title: ReactNode;
  /** A 16px icon before the title, on the cap-height center of its first line */
  icon?: ReactNode;
  /** Text, clamped to `subtitleLines` with an ellipsis */
  subtitle?: ReactNode;
  subtitleLines?: 1 | 2;
  /** Size and color of the subtitle: the reserved lines take the same size */
  subtitleClassName?: string;
  /** Extra classes on the title, such as a hover color */
  titleClassName?: string;
  /** A 32px control after the title: the favourite star */
  action?: ReactNode;
}) {
  const reserve = subtitleLines === 2 ? "lines-2" : "lines-1";
  const clamp = subtitleLines === 2 ? "line-clamp-2" : "line-clamp-1";
  const heading = (
    <div className={`grid ${action ? "min-w-0 flex-1" : ""}`}>
      <div aria-hidden="true" className="invisible col-start-1 row-start-1">
        <div className="type-item-title lines-2" />
        <div className={`mt-1 ${reserve} ${subtitleClassName}`} />
      </div>
      <div className="col-start-1 row-start-1 min-w-0">
        <h3 className={`type-item-title flex gap-1.5 ${titleClassName}`}>
          {icon && <CapAligned height={16}>{icon}</CapAligned>}
          <span className="line-clamp-2 min-w-0 break-words">{title}</span>
        </h3>
        {subtitle != null && subtitle !== "" && (
          <p className={`mt-1 ${clamp} break-words ${subtitleClassName}`}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
  if (!action) return heading;
  // The row carries the title's type, so the action finds its first line
  return (
    <div className="type-item-title flex items-start gap-2">
      {heading}
      {/* 44px on touch; the star keeps its place at the column's edge */}
      <CapAligned height={32} coarseHeight={44} className="relative z-20 icon-hit-end">
        {action}
      </CapAligned>
    </div>
  );
}
