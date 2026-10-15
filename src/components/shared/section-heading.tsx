import { isValidElement } from "react";
import { CapAligned, CapAlignedControls } from "@/components/shared/cap-aligned";

/**
 * The title of a block on a page. Every section title has the same size,
 * color and space below it (16px). An optional count follows the title in
 * the secondary color; an optional icon sits on the title's cap-height
 * center; an optional description goes under the title; an optional action
 * (a button, a link, carousel arrows) sits at the right.
 *
 * An icon-only action must sit on the title's cap-height center: wrap it in
 * `<CapAligned height={…} className="type-section-title">`. Such an action
 * stays on the title's first line when the title wraps.
 *
 * As an h3 it titles a block inside a titled section, in the item title role
 * (`headingRole("h3")`); the same rules apply with that class. As an h4 it
 * titles a group inside a card (an edition's Publication details, Quotes,
 * Copies) in the caption role, with 8px below.
 */
export function headingRole(tag: "h2" | "h3" | "h4" = "h2") {
  return tag === "h4" ? "type-caption" : tag === "h3" ? "type-item-title" : "type-section-title";
}

export function SectionHeading({
  title,
  count,
  icon: Icon,
  description,
  action,
  as: Tag = "h2",
  id,
}: {
  title: React.ReactNode;
  count?: number;
  icon?: React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    "aria-hidden"?: boolean;
  }>;
  description?: React.ReactNode;
  action?: React.ReactNode;
  as?: "h2" | "h3" | "h4";
  id?: string;
}) {
  const heading = (
    // A word wider than the row (a file name) breaks rather than widening the
    // page. break-word, not anywhere: the title's narrowest width stays its
    // longest word, so the row below can tell when that word does not fit
    <Tag id={id} className={`${headingRole(Tag)} [overflow-wrap:break-word]`}>
      {title}
      {/* The count holds on to the title's last word (a no-break space): on a
          phone "Formulations (3)" moves its action under it rather than
          leaving "(3)" on a line of its own (SLN-835) */}
      {count !== undefined && (
        <span className="whitespace-nowrap text-fg-secondary">{"\u00a0"}({count})</span>
      )}
    </Tag>
  );
  return (
    // When the title's longest word and the action do not fit side by side
    // (a 320px phone), the action wraps under the title rather than squeezing
    // the title until a plain word breaks mid-word
    <div className={`${Tag === "h4" ? "mb-2" : "mb-4"} flex flex-wrap items-center justify-between gap-x-4 gap-y-2`}>
      <div className="w-min min-w-0 grow">
        {Icon ? (
          // The row carries the title's type: the icon sits on its
          // cap-height center
          <div className={`${headingRole(Tag)} flex items-start gap-2`}>
            <CapAligned height={16}>
              <Icon
                className="block h-4 w-4 text-fg-muted"
                strokeWidth={1.5}
                aria-hidden
              />
            </CapAligned>
            {heading}
          </div>
        ) : (
          heading
        )}
        {description && (
          <p className="mt-1 text-sm text-fg-secondary">{description}</p>
        )}
      </div>
      {action && (
        // A cap-aligned action is one title line tall: it stays on the first
        // line when the title wraps (a phone), not halfway down the title
        <div
          // ml-auto: when it wraps under the title it stays at the right
          // edge, so a button's padding never sits off the text column
          className={`ml-auto flex shrink-0 items-center gap-2 ${
            isValidElement(action) && (action.type === CapAligned || action.type === CapAlignedControls)
              ? "self-start"
              : ""
          }`}
        >
          {action}
        </div>
      )}
    </div>
  );
}
