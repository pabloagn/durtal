import { z } from "zod/v4";
import { toUpdateSchema } from "./helpers";

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

/** Partial update: no defaults (entityLevel and hierarchical are never reset), unknown keys rejected. */
export const updateTaxonomyFamilySchema = toUpdateSchema(createTaxonomyFamilySchema);

export type CreateTaxonomyFamilyInput = z.input<typeof createTaxonomyFamilySchema>;
export type UpdateTaxonomyFamilyInput = z.input<typeof updateTaxonomyFamilySchema>;

// ── Taxonomy Item Schemas ───────────────────────────────────────────────────

export const createTaxonomyItemSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().max(7).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export const updateTaxonomyItemSchema = toUpdateSchema(createTaxonomyItemSchema);

export const mergeTaxonomyItemsSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
});

// ── Work taxonomy assignment ────────────────────────────────────────────────

const idList = z.array(z.string().uuid()).optional();

export const updateWorkTaxonomySchema = z
  .object({
    subjectIds: idList,
    categoryIds: idList,
    themeIds: idList,
    literaryMovementIds: idList,
    artTypeIds: idList,
    artMovementIds: idList,
    keywordIds: idList,
    attributeIds: idList,
  })
  .strict();

// ── Legacy per-table CRUD (src/lib/actions/taxonomy.ts) ──────────────────────

const slug = z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const createSubjectSchema = z.object({ name: z.string().min(1).max(500), slug }).strict();

export const createGenreSchema = z
  .object({
    name: z.string().min(1).max(500),
    slug,
    parentId: z.string().uuid().nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

export const updateGenreSchema = toUpdateSchema(createGenreSchema);

export const createTagSchema = z
  .object({ name: z.string().min(1).max(500), color: z.string().max(7).nullable().optional() })
  .strict();

export const updateTagSchema = toUpdateSchema(createTagSchema);

export type UpdateWorkTaxonomyInput = z.input<typeof updateWorkTaxonomySchema>;
export type CreateTaxonomyItemInput = z.input<typeof createTaxonomyItemSchema>;
export type UpdateTaxonomyItemInput = z.input<typeof updateTaxonomyItemSchema>;
export type MergeTaxonomyItemsInput = z.input<typeof mergeTaxonomyItemsSchema>;
