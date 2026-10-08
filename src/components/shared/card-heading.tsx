import type { ReactNode } from "react";
import { CapAligned } from "./cap-aligned";

/** Readable names take natural height. Only the first title line shares space
 * with the action; subsequent lines and metadata use the full card width.
 * The row stretches the card bodies, not the title lines: metadata follows
 * its title without a blank line and footers align at the bottom. */
export function CardHeading({
  title, icon, subtitle, subtitleLines = 1,
  subtitleClassName = "text-sm text-fg-secondary",
  titleClassName = "", action,
}: {
  title: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  /** Minimum space, not a clamp: all supplied text remains readable. */
  subtitleLines?: 1 | 2;
  subtitleClassName?: string;
  titleClassName?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-heading min-w-0">
      <div className="type-item-title flow-root">
        {action && (
          <CapAligned height={32} coarseHeight={44} className="relative z-20 float-right ml-2 icon-hit-end">
            {action}
          </CapAligned>
        )}
        <h3 className={`type-item-title [overflow-wrap:anywhere] ${titleClassName}`}>
          {icon && <CapAligned height={16} className="float-left mr-1.5">{icon}</CapAligned>}
          <span>{title}</span>
        </h3>
      </div>
      {subtitle !== undefined && <p className={`mt-1 [overflow-wrap:anywhere] ${subtitleLines === 2 ? "min-h-[2lh]" : "min-h-[1lh]"} ${subtitleClassName}`}>
        {subtitle}
      </p>}
    </div>
  );
}
