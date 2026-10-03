import { CapAligned } from "@/components/shared/cap-aligned";

/**
 * The title of a block on a page. Every section title has the same size,
 * color and space below it (16px). An optional count follows the title in
 * the secondary color; an optional icon sits on the title's cap-height
 * center; an optional description goes under the title; an optional action
 * (a button, a link, carousel arrows) sits at the right.
 *
 * An icon-only action must sit on the title's cap-height center: wrap it in
 * `<CapAligned height={…} className="type-section-title">`.
 */
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
  as?: "h2" | "h3";
  id?: string;
}) {
  const heading = (
    <Tag id={id} className="type-section-title">
      {title}
      {count !== undefined && (
        <span className="text-fg-secondary"> ({count})</span>
      )}
    </Tag>
  );
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        {Icon ? (
          // The row carries the title's type: the icon sits on its
          // cap-height center
          <div className="type-section-title flex items-start gap-2">
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
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
