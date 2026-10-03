import { z } from "zod/v4";

/** Record ids are UUIDs; a bad id gets a clear validation error, not a database error. */
export const idSchema = z.string().uuid("Invalid id");

/** Validate a record id argument of a server action. */
export function parseId(id: unknown): string {
  return idSchema.parse(id);
}

/**
 * Build a partial-update schema from a create schema:
 * - every field is optional;
 * - `.default()` values are removed: Zod 4 applies a default inside an
 *   optional field, so a partial update would overwrite stored data
 *   (`{ notes: "x" }` would reset a copy's status to "available");
 * - unknown keys are rejected, so a request cannot set columns that the
 *   create schema does not expose (slug, createdAt, ids of other rows, ...).
 */
export function toUpdateSchema<Shape extends z.ZodRawShape>(
  create: z.ZodObject<Shape>,
) {
  const fields: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(create.shape)) {
    const inner =
      field instanceof z.ZodDefault
        ? (field.unwrap() as z.ZodType)
        : (field as z.ZodType);
    fields[key] = inner.optional();
  }
  return z.object(fields).strict() as unknown as z.ZodObject<{
    [K in keyof Shape]: z.ZodOptional<Shape[K]>;
  }>;
}
