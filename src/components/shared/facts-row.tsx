import type { ReactNode } from "react";

/**
 * A header's facts in reading order, split by "·": "Imprint of Penguin Books
 * · United Kingdom · Founded 1961".
 *
 * A separator never starts a line. Each fact carries the separator before
 * it, centred in the 20px gap that parts it from the fact before. The row
 * reaches that gap's width past the column's left edge and clips 16px of it,
 * so the separator of a fact that starts a line falls outside and is not
 * drawn; the last 4px leave room for a focus ring.
 * The separators are hidden from screen readers, which read the facts as
 * before.
 */
export function FactsRow({
  facts,
  small = false,
  className = "",
}: {
  facts: ReactNode[];
  /** 12px, for a list row's secondary lines; 14px otherwise */
  small?: boolean;
  className?: string;
}) {
  if (facts.length === 0) return null;
  return (
    <p
      className={`-ml-5 flex flex-wrap items-baseline ${small ? "text-xs" : "text-sm"} text-fg-secondary [clip-path:inset(-0.5rem_-0.5rem_-0.5rem_1rem)] ${className}`}
    >
      {facts.map((fact, i) => (
        <span key={i} className="relative ml-5 min-w-0">
          <span aria-hidden="true" className="absolute right-full w-5 text-center">
            ·
          </span>
          {fact}
        </span>
      ))}
    </p>
  );
}
