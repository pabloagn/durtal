import { WORK_KINDS, type WorkKind } from "./kinds";
import { countLabel } from "@/lib/utils/format";

/** One of a person's roles, with how many credits they hold in it */
export interface PersonRole {
  /** The registry id ("film.director"), when the role came from the data */
  roleId?: string;
  kind: WorkKind;
  label: string;
  count: number;
}

/** Roles a card shows before "+N"; the tooltip lists them all */
export const VISIBLE_ROLES = 2;

/**
 * What a person card says the person is (SLN-420): a role the list is
 * filtered by first, then the open collection's roles, then the rest by
 * credits; at most two, then "+N". The labels come from the role registry,
 * never from a guess. A person with no credits has none: null, never
 * "Unknown".
 */
export function formatPersonRoles(
  roles: PersonRole[] | undefined,
  preferKind?: WorkKind | null,
  /** Roles a filter asks for: they lead, so the line shows why the person is listed */
  preferRoles?: string[] | null,
): { text: string; full: string } | null {
  if (!roles?.length) return null;
  // One label once, with the credits of every collection that uses it
  const byLabel = new Map<string, { label: string; count: number; rank: number }>();
  for (const role of roles) {
    const entry = byLabel.get(role.label) ?? { label: role.label, count: 0, rank: 0 };
    entry.count += role.count;
    const rank =
      role.roleId && preferRoles?.includes(role.roleId) ? 2 : role.kind === preferKind ? 1 : 0;
    entry.rank = Math.max(entry.rank, rank);
    byLabel.set(role.label, entry);
  }
  const ordered = [...byLabel.values()].sort(
    (a, b) => b.rank - a.rank || b.count - a.count || a.label.localeCompare(b.label),
  );
  const shown = ordered.slice(0, VISIBLE_ROLES).map((r) => r.label).join(" · ");
  const rest = ordered.length - VISIBLE_ROLES;
  return {
    text: rest > 0 ? `${shown} +${rest}` : shown,
    full: ordered.map((r) => r.label).join(", "),
  };
}

const KIND_NOUNS: Record<WorkKind, string> = { book: "book", film: "film", perfume: "perfume", painting: "painting" };

/**
 * A person card's works, per collection in the collections' order: "2 books",
 * "3 films · 1 perfume" (SLN-1025). Null with none.
 */
export function formatWorkCounts(counts: Partial<Record<WorkKind, number>> | undefined): string | null {
  const parts = WORK_KINDS.filter((kind) => (counts?.[kind] ?? 0) > 0).map((kind) =>
    countLabel(counts![kind]!, KIND_NOUNS[kind]),
  );
  return parts.length ? parts.join(" · ") : null;
}
