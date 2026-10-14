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

/**
 * A detail page's title row: the title and its actions.
 * - With `row`, the row of a page drawn with `DetailTitleRow` (`wide` for the
 *   book's controls): it wraps where that row does, with no gap under the
 *   title. On a phone the title takes the row and the actions go under it, as
 *   they do for nearly every book and publisher. On a wider screen with a
 *   mouse they stay beside it, as they do for a title that fits there.
 * - Without, the film's and painting's row: a title that fits on one line
 *   keeps its star and menu beside it at every width, so the skeleton draws
 *   that. A longer title takes more lines, which no loading screen can know.
 */
export function SkeletonTitleRow({ row }: { row?: keyof typeof DETAIL_TITLE_ROW }) {
  if (row)
    return (
      <div className="@container">
        <div className={`type-page-title flex flex-wrap items-start ${DETAIL_TITLE_ROW[row]}`}>
          <SkeletonLine className="type-page-title w-full min-w-0 sm:w-2/3 sm:pointer-fine:w-auto sm:pointer-fine:flex-1" />
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
