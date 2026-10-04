import { formatPersonRoles, type PersonRole } from "@/lib/catalogue/person-roles";
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
      className={`lines-1 text-xs text-fg-secondary ${className}`}
      data-tooltip={line && line.full !== line.text ? line.full : undefined}
    >
      {line ? line.text : " "}
    </p>
  );
}
