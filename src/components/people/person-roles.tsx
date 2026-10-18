import { formatPersonRoles, formatWorkCounts, type PersonRole } from "@/lib/catalogue/person-roles";
import type { WorkKind } from "@/lib/catalogue/kinds";

/**
 * A person card's role line: "Author · Translator +1", the full list in its
 * tooltip. The line is always there, empty for a person with no credits, so
 * cards of one kind keep one height.
 */
export function PersonRoles({
  roles,
  preferKind,
  preferRoles,
  className = "",
}: {
  roles?: PersonRole[];
  preferKind?: WorkKind | null;
  /** Roles the list is filtered by: they lead the line */
  preferRoles?: string[] | null;
  className?: string;
}) {
  const line = formatPersonRoles(roles, preferKind, preferRoles);
  return (
    <p
      className={`min-h-[1lh] [overflow-wrap:anywhere] text-xs text-fg-secondary ${className}`}
      data-tooltip={line && line.full !== line.text ? line.full : undefined}
    >
      {line ? line.text : " "}
    </p>
  );
}

/**
 * A person's works per collection, "14 films · 1 perfume" (SLN-1025). It
 * breaks only after a "·", so no line starts with one; nothing for none.
 */
export function WorkCounts({
  counts,
  className = "",
}: {
  counts?: Partial<Record<WorkKind, number>>;
  className?: string;
}) {
  const works = formatWorkCounts(counts);
  if (!works) return null;
  return (
    <span className={className}>
      {works.split(" · ").map((part, i, all) => (
        <span key={part} className="whitespace-nowrap">
          {part}
          {i < all.length - 1 ? " · " : ""}
        </span>
      ))}
    </span>
  );
}
