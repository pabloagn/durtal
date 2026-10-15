import { DETAIL_TITLE_ROW } from "./detail-layout";

/**
 * Loading screens (contract section 8, "Loading keeps the page's final
 * layout"). A skeleton draws the page's own layout with these blocks in place
 * of its content, so nothing jumps when the content arrives.
 */

/**
 * A still block of known size: a picture or a button, or with `text` a row
 * of text (in the lighter tone of `SkeletonLine`)
 */
export function SkeletonBlock({
  className = "",
  style,
  text = false,
}: {
  className?: string;
  style?: React.CSSProperties;
  text?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-sm ${text ? "bg-bg-secondary" : "bg-bg-tertiary"} motion-safe:animate-pulse ${className}`}
      style={style}
    />
  );
}

/**
 * One line of text: as tall as a line of the type it stands in for (pass that
 * type's class, such as `type-page-title` or `text-sm`), so the text below it
 * starts where it will.
 */
export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`h-[1lh] rounded-sm bg-bg-secondary motion-safe:animate-pulse ${className}`} />;
}

// The title line takes two thirds of the row where `DETAIL_TITLE_ROW` stops
// wrapping, and the whole row below it (SLN-698)
const TITLE_LINE = {
  standard: "@min-[24rem]:w-2/3",
  wide: "not-pointer-coarse:@min-[33rem]:w-2/3 pointer-coarse:@min-[39rem]:w-2/3",
} satisfies Partial<Record<keyof typeof DETAIL_TITLE_ROW, string>>;

/**
 * A detail page's title row: the title and its actions.
 * - With `row`, the row of a page drawn with `DetailTitleRow controls="…"`
 *   (`wide` for the book, `standard` for the publisher): it wraps where that
 *   row does, with no gap under the title. Below the width where that row
 *   stops wrapping, the title takes the row and the actions go under it, as
 *   they do for every title but the shortest; from that width on they stay
 *   beside it.
 * - Without, the film's and painting's row (`stacked`): a title that fits on
 *   one line keeps its star and menu beside it at every width, so the
 *   skeleton draws that. A longer title takes more lines, which no loading
 *   screen can know.
 */
export function SkeletonTitleRow({ row }: { row?: keyof typeof TITLE_LINE }) {
  if (row)
    return (
      <div className="@container">
        <div className={`type-page-title flex flex-wrap items-start ${DETAIL_TITLE_ROW[row]}`}>
          <SkeletonLine className={`type-page-title w-full min-w-0 ${TITLE_LINE[row]}`} />
          <div className="type-page-title flex h-[1lh] shrink-0 items-center">
            <SkeletonBlock className="h-8 w-40 pointer-coarse:h-11" />
          </div>
        </div>
      </div>
    );
  return (
    <div className="flex items-start justify-between gap-3">
      <SkeletonLine className="type-page-title w-1/2 sm:w-2/3" />
      <div className="type-page-title flex h-[1lh] shrink-0 items-center">
        <SkeletonBlock className="h-8 w-18 pointer-coarse:w-24" />
      </div>
    </div>
  );
}

/**
 * A detail page's facts (`dl`, 24px rows, `mt-5`): the label and value of
 * each row a page always has. The last is the rating, whose stars take a row
 * of their own on a phone.
 */
export function SkeletonFacts({ rows }: { rows: number }) {
  return (
    <div className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="contents">
          <SkeletonBlock text className="h-6 w-24" />
          <SkeletonBlock text className={`h-6 w-40 max-w-full ${row === rows - 1 ? "col-span-2 sm:col-span-1" : ""}`} />
        </div>
      ))}
    </div>
  );
}
