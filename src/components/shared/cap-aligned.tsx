import type { CSSProperties, ReactNode } from "react";

/**
 * Centers a fixed-height box (an icon, a small button or button group) on the
 * cap height of the first text line beside it: the optical center of
 * capitalized text, for any font, size and line height. Plain `items-center`
 * centers on the line box instead, which sits 2–5px off beside serif text.
 *
 * Use it inside a flex row, next to the text. The row (or `className`) must
 * carry the text's font size, family and line height: the slot is one line
 * tall and `0.5cap` resolves against that font.
 *
 * How it works: an inline-block with `overflow: hidden` takes its baseline
 * from its bottom margin edge. Negative block margins of half its height move
 * that edge to the box's center and keep the box from stretching the line.
 * `vertical-align: 0.5cap` then raises the center to the cap-height center.
 * Measured in Chrome: 0.00–0.02px off for serif and sans text of 13–46px and
 * boxes of 14–44px. The box clips, so focus rings inside it are drawn inset.
 */
export function CapAligned({
  height,
  coarseHeight,
  className = "",
  children,
}: {
  /** Height of the box in px */
  height: number;
  /** Height on a coarse pointer (touch), when the box grows there */
  coarseHeight?: number;
  className?: string;
  children: ReactNode;
}) {
  if (coarseHeight === undefined)
    return (
      <span className={`block h-[1lh] shrink-0 ${className}`}>
        <span
          className="cap-box"
          style={{ height, marginBlock: -height / 2 }}
        >
          {children}
        </span>
      </span>
    );
  return (
    <span className={`block h-[1lh] shrink-0 ${className}`}>
      <span
        className="cap-box h-(--cap-box) [margin-block:calc(var(--cap-box)/-2)] pointer-coarse:h-(--cap-box-coarse) pointer-coarse:[margin-block:calc(var(--cap-box-coarse)/-2)]"
        style={{ "--cap-box": `${height}px`, "--cap-box-coarse": `${coarseHeight}px` } as CSSProperties}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * CapAligned for controls that open something, such as an action menu: the
 * box clips nothing, so the menu shows in full, and the controls and what
 * they open take the body type again, not the title's. Controls sit 8px
 * apart.
 *
 * How it works: an inline-block whose only content is a float has no line
 * boxes, so its baseline is its bottom margin edge, as with `overflow:
 * hidden`; the float sizes the box and clips nothing. The rest is as in
 * CapAligned. Measured in Chrome: 0.01px off beside a 46px serif title.
 */
export function CapAlignedControls({
  height,
  className = "",
  children,
}: {
  /** Height of the controls in px */
  height: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`block h-[1lh] shrink-0 ${className}`}>
      <span
        className="inline-block align-[0.5cap]"
        style={{ height, marginBlock: -height / 2 }}
      >
        <span
          className="float-left flex items-center gap-2 font-sans text-sm font-normal not-italic tracking-normal"
          style={{ height }}
        >
          {children}
        </span>
      </span>
    </span>
  );
}
