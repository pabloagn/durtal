import { z } from "zod";
import { stableStringify } from "@/lib/harmonization/normalize";

export const SOURCE_ENTITY_KINDS = [
  "book",
  "film",
  "perfume",
  "painting",
  "edition",
  "person",
  "organization",
  "venue",
] as const;
export type SourceEntityKind = (typeof SOURCE_ENTITY_KINDS)[number];
export const sourceOwnerSchema = z.object({
  kind: z.enum(SOURCE_ENTITY_KINDS),
  id: z.uuid(),
});
export type SourceOwner = z.infer<typeof sourceOwnerSchema>;
export const providerSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
export const sourceUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(4000)
  .refine((value) => {
    if (!URL.canParse(value) || /\s/.test(value)) return false;
    const url = new URL(value);
    return !url.username && !url.password;
  }, "Source links cannot contain embedded credentials");
export function ownerColumns(input: SourceOwner) {
  const owner = sourceOwnerSchema.parse(input);
  return {
    entityKind: owner.kind,
    workId: ["book", "film", "perfume", "painting"].includes(owner.kind)
      ? owner.id
      : null,
    editionId: owner.kind === "edition" ? owner.id : null,
    personId: owner.kind === "person" ? owner.id : null,
    organizationId: owner.kind === "organization" ? owner.id : null,
    venueId: owner.kind === "venue" ? owner.id : null,
  };
}
export function sourceOwnerColumn(kind: SourceEntityKind) {
  return kind === "edition"
    ? "edition_id"
    : kind === "person"
      ? "person_id"
      : kind === "organization"
        ? "organization_id"
        : kind === "venue"
          ? "venue_id"
          : "work_id";
}

/** Pure proposal: existing values and manually locked fields are never overwritten. */
export function proposeSourcedChanges<T extends Record<string, unknown>>(
  current: T,
  incoming: Partial<T>,
  locked: readonly (keyof T)[] = [],
) {
  const changes: Partial<T> = {};
  const conflicts: {
    field: keyof T;
    current: unknown;
    incoming: unknown;
    reason: "locked" | "different";
  }[] = [];
  for (const field of Object.keys(incoming) as (keyof T)[]) {
    const value = incoming[field];
    if (value === undefined || value === null || value === "") continue;
    if (stableStringify(current[field]) === stableStringify(value)) continue;
    if (locked.includes(field))
      conflicts.push({
        field,
        current: current[field],
        incoming: value,
        reason: "locked",
      });
    else if (
      current[field] === null ||
      current[field] === undefined ||
      current[field] === ""
    )
      Object.defineProperty(changes, field, { value, enumerable: true });
    else
      conflicts.push({
        field,
        current: current[field],
        incoming: value,
        reason: "different",
      });
  }
  return { changes, conflicts };
}
