import { Fragment } from "react";
import { CapAligned } from "@/components/shared/cap-aligned";
import type { ReadingEstimate } from "@/lib/reading/pace";
import { EstimateInfo } from "./estimate-info";

/*
 * An open reading's estimate (SLN-451): "About 6 h 40 min left · Around
 * 18 Oct" and its info button. Server text where the card is server
 * rendered; only the button is a client island.
 */
export function EstimateLine({
  estimate,
  className = "",
  lines = "",
  onAddLength,
}: {
  estimate: ReadingEstimate;
  className?: string;
  /** "lines-2" on cards that share one height; the book page lets it wrap */
  lines?: string;
  onAddLength?: () => void;
}) {
  // A line breaks between its parts, never inside "Around 25 Oct"; a long part
  // ("Log a few sessions for an estimate") may wrap, so a narrow card never widens
  const parts = estimate.text.split(" · ");
  const text = parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && " "}
      <span className={part.length <= 24 ? "whitespace-nowrap" : undefined}>
        {part}
        {i < parts.length - 1 ? " ·" : ""}
      </span>
    </Fragment>
  ));
  return (
    <div className={`flex items-start gap-1 text-xs text-fg-secondary ${className}`} data-estimate="">
      {estimate.needsLength && onAddLength ? (
        <button type="button" onClick={onAddLength} className={`${lines} text-left underline-offset-2 hover:text-fg-primary hover:underline`}>
          {text}
        </button>
      ) : (
        <span className={`${lines} min-w-0`}>{text}</span>
      )}
      {estimate.explanation && (
        <CapAligned height={24} coarseHeight={44}>
          <EstimateInfo text={estimate.explanation} />
        </CapAligned>
      )}
    </div>
  );
}
