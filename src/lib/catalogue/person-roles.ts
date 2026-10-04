import type { WorkKind } from "./kinds";

/** One of a person's roles, with how many credits they hold in it */
export interface PersonRole {
  kind: WorkKind;
  label: string;
  count: number;
}

/** Roles a card shows before "+N"; the tooltip lists them all */
export const VISIBLE_ROLES = 2;

/**
 * What a person card says the person is (SLN-420): the role with the most
 * credits first, the open collection's roles before the others, at most two,
 * then "+N". The labels come from the role registry, never from a guess. A
 * person with no credits has none: null, never "Unknown".
 */
export function formatPersonRoles(
  roles: PersonRole[] | undefined,
  preferKind?: WorkKind | null,
): { text: string; full: string } | null {
  if (!roles?.length) return null;
  // One label once, with the credits of every collection that uses it
  const byLabel = new Map<string, { label: string; count: number; preferred: boolean }>();
  for (const role of roles) {
    const entry = byLabel.get(role.label) ?? { label: role.label, count: 0, preferred: false };
    entry.count += role.count;
    entry.preferred ||= role.kind === preferKind;
    byLabel.set(role.label, entry);
  }
  const ordered = [...byLabel.values()].sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      b.count - a.count ||
      a.label.localeCompare(b.label),
  );
  const shown = ordered.slice(0, VISIBLE_ROLES).map((r) => r.label).join(" · ");
  const rest = ordered.length - VISIBLE_ROLES;
  return {
    text: rest > 0 ? `${shown} +${rest}` : shown,
    full: ordered.map((r) => r.label).join(", "),
  };
}
