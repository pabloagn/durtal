import { z } from "zod/v4";

// ── Taxonomy Family Schemas ─────────────────────────────────────────────────

export const createTaxonomyFamilySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(1000).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  color: z.string().max(7).nullable().optional(),
  entityLevel: z.enum(["work", "edition"]).default("work"),
  hierarchical: z.boolean().default(false),
});

export const updateTaxonomyFamilySchema = createTaxonomyFamilySchema.partial();

export type CreateTaxonomyFamilyInput = z.input<typeof createTaxonomyFamilySchema>;
export type UpdateTaxonomyFamilyInput = z.input<typeof updateTaxonomyFamilySchema>;

// ── Taxonomy Item Schemas ───────────────────────────────────────────────────

export const createTaxonomyItemSchema = z.object({
  name: z.string().min(1).max(500),
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
