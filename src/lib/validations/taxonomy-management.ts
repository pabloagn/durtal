import { z } from "zod/v4";
import { WORK_KINDS } from "@/lib/catalogue/kinds";
import { TAXONOMY_LEVELS, validTaxonomyScope } from "@/lib/catalogue/taxonomies";

// ── Taxonomy Family Schemas ─────────────────────────────────────────────────

/** One domain and record level a family applies to (validated against the registry). */
export const taxonomyScopeSchema = z
  .strictObject({ kind: z.enum(WORK_KINDS), level: z.enum(TAXONOMY_LEVELS) })
  .refine(
    (s) => validTaxonomyScope(s.kind, s.level),
    "Invalid domain and record level",
  );
export const taxonomyScopesSchema = z
  .array(taxonomyScopeSchema)
  .min(1, "Choose at least one place this family applies")
  .max(20)
  .refine(
    (list) => new Set(list.map((s) => `${s.kind}:${s.level}`)).size === list.length,
    "List each scope once",
  );

const familyFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
  icon: z.string().max(50).nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  hierarchical: z.boolean(),
};
/** The URL slug is derived from the name on creation and never changes. */
export const createTaxonomyFamilySchema = z.strictObject({
  name: familyFields.name,
  description: familyFields.description.default(null),
  icon: familyFields.icon.default(null),
  color: familyFields.color.default(null),
  hierarchical: familyFields.hierarchical.default(false),
  scopes: taxonomyScopesSchema,
});
/**
 * System families keep their storage, hierarchy and scopes; only their
 * presentation can change. Scopes replace the custom family's scopes.
 */
export const updateTaxonomyFamilySchema = z
  .strictObject({ ...familyFields, scopes: taxonomyScopesSchema })
  .partial();

export type CreateTaxonomyFamilyInput = z.input<
  typeof createTaxonomyFamilySchema
>;
export type UpdateTaxonomyFamilyInput = z.input<
  typeof updateTaxonomyFamilySchema
>;

// ── Taxonomy Item Schemas ───────────────────────────────────────────────────

export const createTaxonomyItemSchema = z.object({
  name: z.string().trim().min(1).max(500),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().max(7).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export const updateTaxonomyItemSchema = createTaxonomyItemSchema.partial();

export const mergeTaxonomyItemsSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
});

export type CreateTaxonomyItemInput = z.input<typeof createTaxonomyItemSchema>;
export type UpdateTaxonomyItemInput = z.input<typeof updateTaxonomyItemSchema>;
export type MergeTaxonomyItemsInput = z.input<typeof mergeTaxonomyItemsSchema>;
