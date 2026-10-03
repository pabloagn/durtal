import type { ReactNode } from "react";

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
 * How it works: an inline-block whose only content is a float has no line
 * boxes, so its baseline is its bottom margin edge. Negative block margins of
 * half its height move that edge to the box's center and keep the box from
 * stretching the line. `vertical-align: 0.5cap` then raises the center to the
 * cap-height center. The float sizes the box and clips nothing: focus rings
 * and menus that open from the box stay visible. Measured in Chrome:
 * 0.00–0.02px off for serif and sans text of 13–46px and boxes of 14–44px.
 */
export function CapAligned({
  height,
  className = "",
  children,
}: {
  /** Height of the box in px */
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
        <span className="float-left flex">{children}</span>
      </span>
    </span>
  );
}
