"use server";

import { db } from "@/lib/db";
import {
  taxonomyFamilies,
  customTaxonomyItems,
  customTaxonomyItemWorks,
  customTaxonomyItemEditions,
  subjects,
  genres,
  tags,
  bookCategories,
  themes,
  literaryMovements,
  artTypes,
  artMovements,
  keywords,
  attributes,
  workSubjects,
  editionGenres,
  editionTags,
  workCategories,
  workThemes,
  workLiteraryMovements,
  workArtTypes,
  workArtMovements,
  workKeywords,
  workAttributes,
} from "@/lib/db/schema";
import { eq, asc, sql, and } from "drizzle-orm";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";
import {
  isSystemFamily,
  getSystemRegistry,
  type SystemFamilySlug,
} from "@/lib/db/taxonomy-resolver";
import {
  createTaxonomyFamilySchema,
  updateTaxonomyFamilySchema,
  createTaxonomyItemSchema,
  updateTaxonomyItemSchema,
  mergeTaxonomyItemsSchema,
} from "@/lib/validations/taxonomy-management";
import { slugify } from "@/lib/utils/slugify";

// ── Cache helpers ────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// FAMILY CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// ── Get All Families ────────────────────────────────────────────────────────

export const getTaxonomyFamilies = cached(
  async () => {
    const families = await db
      .select()
      .from(taxonomyFamilies)
      .orderBy(asc(taxonomyFamilies.sortOrder), asc(taxonomyFamilies.name));

    // Compute item counts and entity counts per family
    const enriched = await Promise.all(
      families.map(async (family) => {
        let itemCount = 0;
        let entityCount = 0;

        if (family.isSystem && isSystemFamily(family.slug)) {
          const reg = getSystemRegistry(family.slug);
          const [itemRow] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(reg.table);
          itemCount = itemRow?.count ?? 0;

          const [entityRow] = await db
            .select({ count: sql<number>`count(DISTINCT ${reg.junctionEntityCol})::int` })
            .from(reg.junction);
          entityCount = entityRow?.count ?? 0;
        } else {
          const [itemRow] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(customTaxonomyItems)
            .where(eq(customTaxonomyItems.familyId, family.id));
          itemCount = itemRow?.count ?? 0;

          if (family.entityLevel === "work") {
            const [entityRow] = await db
              .select({ count: sql<number>`count(DISTINCT ${customTaxonomyItemWorks.workId})::int` })
              .from(customTaxonomyItemWorks)
              .innerJoin(
                customTaxonomyItems,
                eq(customTaxonomyItemWorks.itemId, customTaxonomyItems.id),
              )
              .where(eq(customTaxonomyItems.familyId, family.id));
            entityCount = entityRow?.count ?? 0;
          } else {
            const [entityRow] = await db
              .select({ count: sql<number>`count(DISTINCT ${customTaxonomyItemEditions.editionId})::int` })
              .from(customTaxonomyItemEditions)
              .innerJoin(
                customTaxonomyItems,
                eq(customTaxonomyItemEditions.itemId, customTaxonomyItems.id),
              )
              .where(eq(customTaxonomyItems.familyId, family.id));
            entityCount = entityRow?.count ?? 0;
          }
        }

        return { ...family, itemCount, entityCount };
      }),
    );

    return enriched;
  },
  ["taxonomy-families"],
  [CACHE_TAGS.taxonomyFamilies],
);

// ── Get Single Family ───────────────────────────────────────────────────────

export async function getTaxonomyFamily(slug: string) {
  const [family] = await db
    .select()
    .from(taxonomyFamilies)
    .where(eq(taxonomyFamilies.slug, slug))
    .limit(1);
  return family ?? null;
}

// ── Create Family ───────────────────────────────────────────────────────────

export async function createTaxonomyFamily(input: unknown) {
  const parsed = createTaxonomyFamilySchema.parse(input);

  // Determine next sort order
  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${taxonomyFamilies.sortOrder}), 0)::int` })
    .from(taxonomyFamilies);
  const nextOrder = (maxRow?.max ?? 0) + 1;

  const [family] = await db
    .insert(taxonomyFamilies)
    .values({
      ...parsed,
      isSystem: false,
      sortOrder: nextOrder,
    })
    .returning();

  invalidate(CACHE_TAGS.taxonomyFamilies);
  return family;
}

// ── Update Family ───────────────────────────────────────────────────────────

export async function updateTaxonomyFamily(id: string, input: unknown) {
  const parsed = updateTaxonomyFamilySchema.parse(input);

  const [updated] = await db
    .update(taxonomyFamilies)
    .set(parsed)
    .where(eq(taxonomyFamilies.id, id))
    .returning();

  invalidate(CACHE_TAGS.taxonomyFamilies);
  return updated;
}

// ── Delete Family ───────────────────────────────────────────────────────────

export async function deleteTaxonomyFamily(id: string) {
  // Block deletion of system families
  const [family] = await db
    .select({ isSystem: taxonomyFamilies.isSystem })
    .from(taxonomyFamilies)
    .where(eq(taxonomyFamilies.id, id))
    .limit(1);

  if (!family) throw new Error("Taxonomy family not found");
  if (family.isSystem) throw new Error("Cannot delete a system taxonomy family");

  await db.delete(taxonomyFamilies).where(eq(taxonomyFamilies.id, id));
  invalidate(CACHE_TAGS.taxonomyFamilies, CACHE_TAGS.customTaxonomyItems);
  return { id };
}

// ── Reorder Families ────────────────────────────────────────────────────────

export async function reorderFamilies(ids: string[]) {
  await Promise.all(
    ids.map((id, index) =>
      db
        .update(taxonomyFamilies)
        .set({ sortOrder: index })
        .where(eq(taxonomyFamilies.id, id)),
    ),
  );
  invalidate(CACHE_TAGS.taxonomyFamilies);
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED ITEM CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// ── Get Items ───────────────────────────────────────────────────────────────

export async function getTaxonomyItems(familySlug: string) {
  const family = await getTaxonomyFamily(familySlug);
  if (!family) return [];

  if (isSystemFamily(familySlug)) {
    return getSystemItems(familySlug);
  }

  // Custom family
  const items = await db
    .select({
      id: customTaxonomyItems.id,
      name: customTaxonomyItems.name,
      slug: customTaxonomyItems.slug,
      color: customTaxonomyItems.color,
      description: customTaxonomyItems.description,
      parentId: customTaxonomyItems.parentId,
      sortOrder: customTaxonomyItems.sortOrder,
      entityCount: sql<number>`(
        SELECT count(*) FROM custom_taxonomy_item_works WHERE item_id = ${customTaxonomyItems.id}
      )::int`,
    })
    .from(customTaxonomyItems)
    .where(eq(customTaxonomyItems.familyId, family.id))
    .orderBy(asc(customTaxonomyItems.sortOrder), asc(customTaxonomyItems.name));
  return items;
}

async function getSystemItems(familySlug: SystemFamilySlug) {
  switch (familySlug) {
    case "subjects": {
      return db
        .select({
          id: subjects.id, name: subjects.name, slug: subjects.slug, color: subjects.color,
          entityCount: sql<number>`(SELECT count(*) FROM work_subjects WHERE subject_id = ${subjects.id})::int`,
        })
        .from(subjects)
        .orderBy(asc(subjects.name));
    }
    case "genres": {
      return db
        .select({
          id: genres.id, name: genres.name, slug: genres.slug, color: genres.color,
          parentId: genres.parentId, sortOrder: genres.sortOrder,
          entityCount: sql<number>`(SELECT count(*) FROM edition_genres WHERE genre_id = ${genres.id})::int`,
        })
        .from(genres)
        .orderBy(asc(genres.sortOrder));
    }
    case "tags": {
      return db
        .select({
          id: tags.id, name: tags.name, slug: tags.slug, color: tags.color,
          entityCount: sql<number>`(SELECT count(*) FROM edition_tags WHERE tag_id = ${tags.id})::int`,
        })
        .from(tags)
        .orderBy(asc(tags.name));
    }
    case "categories": {
      return db
        .select({
          id: bookCategories.id, name: bookCategories.name, slug: bookCategories.slug, color: bookCategories.color,
          parentId: bookCategories.parentId, sortOrder: bookCategories.sortOrder,
          entityCount: sql<number>`(SELECT count(*) FROM work_categories WHERE category_id = ${bookCategories.id})::int`,
        })
        .from(bookCategories)
        .orderBy(asc(bookCategories.sortOrder));
    }
    case "themes": {
      return db
        .select({
          id: themes.id, name: themes.name, slug: themes.slug, color: themes.color,
          parentId: themes.parentId, sortOrder: themes.sortOrder,
          entityCount: sql<number>`(SELECT count(*) FROM work_themes WHERE theme_id = ${themes.id})::int`,
        })
        .from(themes)
        .orderBy(asc(themes.sortOrder));
    }
    case "literary-movements": {
      return db
        .select({
          id: literaryMovements.id, name: literaryMovements.name, slug: literaryMovements.slug, color: literaryMovements.color,
          parentId: literaryMovements.parentId, sortOrder: literaryMovements.sortOrder,
          entityCount: sql<number>`(SELECT count(*) FROM work_literary_movements WHERE literary_movement_id = ${literaryMovements.id})::int`,
        })
        .from(literaryMovements)
        .orderBy(asc(literaryMovements.sortOrder));
    }
    case "art-types": {
      return db
        .select({
          id: artTypes.id, name: artTypes.name, slug: artTypes.slug, color: artTypes.color,
          entityCount: sql<number>`(SELECT count(*) FROM work_art_types WHERE art_type_id = ${artTypes.id})::int`,
        })
        .from(artTypes)
        .orderBy(asc(artTypes.name));
    }
    case "art-movements": {
      return db
        .select({
          id: artMovements.id, name: artMovements.name, slug: artMovements.slug, color: artMovements.color,
          entityCount: sql<number>`(SELECT count(*) FROM work_art_movements WHERE art_movement_id = ${artMovements.id})::int`,
        })
        .from(artMovements)
        .orderBy(asc(artMovements.name));
    }
    case "keywords": {
      return db
        .select({
          id: keywords.id, name: keywords.name, slug: keywords.slug, color: keywords.color,
          entityCount: sql<number>`(SELECT count(*) FROM work_keywords WHERE keyword_id = ${keywords.id})::int`,
        })
        .from(keywords)
        .orderBy(asc(keywords.name));
    }
    case "attributes": {
      return db
        .select({
          id: attributes.id, name: attributes.name, slug: attributes.slug, color: attributes.color,
          entityCount: sql<number>`(SELECT count(*) FROM work_attributes WHERE attribute_id = ${attributes.id})::int`,
        })
        .from(attributes)
        .orderBy(asc(attributes.name));
    }
  }
}

// ── Get Single Item ─────────────────────────────────────────────────────────

export async function getTaxonomyItem(familySlug: string, itemSlug: string) {
  const family = await getTaxonomyFamily(familySlug);
  if (!family) return null;

  if (isSystemFamily(familySlug)) {
    const reg = getSystemRegistry(familySlug);
    const [item] = await db
      .select({
        id: reg.table.id,
        name: reg.table.name,
        slug: reg.table.slug,
        color: reg.table.color,
      })
      .from(reg.table)
      .where(eq(reg.table.slug, itemSlug))
      .limit(1);

    if (!item) return null;

    // Fetch associated entity IDs
    const entityRows = await db
      .select({ entityId: reg.junctionEntityCol })
      .from(reg.junction)
      .where(eq(reg.junctionItemCol, item.id));

    return { ...item, entityIds: entityRows.map((r) => r.entityId) };
  }

  // Custom family
  const [item] = await db
    .select()
    .from(customTaxonomyItems)
    .where(
      and(
        eq(customTaxonomyItems.familyId, family.id),
        eq(customTaxonomyItems.slug, itemSlug),
      ),
    )
    .limit(1);

  if (!item) return null;

  // Fetch entity IDs based on entity level
  if (family.entityLevel === "work") {
    const entityRows = await db
      .select({ entityId: customTaxonomyItemWorks.workId })
      .from(customTaxonomyItemWorks)
      .where(eq(customTaxonomyItemWorks.itemId, item.id));
    return { ...item, entityIds: entityRows.map((r) => r.entityId) };
  }

  const entityRows = await db
    .select({ entityId: customTaxonomyItemEditions.editionId })
    .from(customTaxonomyItemEditions)
    .where(eq(customTaxonomyItemEditions.itemId, item.id));
  return { ...item, entityIds: entityRows.map((r) => r.entityId) };
}

// ── Create Item ─────────────────────────────────────────────────────────────

export async function createTaxonomyItem(familySlug: string, input: unknown) {
  const parsed = createTaxonomyItemSchema.parse(input);
  const slug = slugify(parsed.name);
  const family = await getTaxonomyFamily(familySlug);
  if (!family) throw new Error(`Taxonomy family "${familySlug}" not found`);

  if (isSystemFamily(familySlug)) {
    return createSystemItem(familySlug, parsed, slug);
  }

  // Custom family
  const [item] = await db
    .insert(customTaxonomyItems)
    .values({
      familyId: family.id,
      name: parsed.name,
      slug,
      description: parsed.description ?? null,
      color: parsed.color ?? null,
      parentId: parsed.parentId ?? null,
    })
    .returning();

  invalidate(CACHE_TAGS.taxonomyFamilies, CACHE_TAGS.customTaxonomyItems);
  return item;
}

async function createSystemItem(
  familySlug: SystemFamilySlug,
  parsed: { name: string; description?: string | null; color?: string | null; parentId?: string | null },
  slug: string,
) {
  switch (familySlug) {
    case "subjects": {
      const [item] = await db
        .insert(subjects)
        .values({ name: parsed.name, slug, description: parsed.description ?? null, color: parsed.color ?? null })
        .returning();
      invalidate(CACHE_TAGS.subjects, CACHE_TAGS.taxonomyFamilies);
      return item;
    }
    case "genres": {
      const [item] = await db
        .insert(genres)
        .values({ name: parsed.name, slug, color: parsed.color ?? null, parentId: parsed.parentId ?? null })
        .returning();
      invalidate(CACHE_TAGS.genres, CACHE_TAGS.taxonomyFamilies);
      return item;
    }
    case "tags": {
      const [item] = await db
        .insert(tags)
        .values({ name: parsed.name, slug, color: parsed.color ?? null })
        .returning();
      invalidate(CACHE_TAGS.tags, CACHE_TAGS.taxonomyFamilies);
      return item;
    }
    case "categories": {
      const [item] = await db
        .insert(bookCategories)
        .values({
          name: parsed.name,
          slug,
          level: 0,
          color: parsed.color ?? null,
          parentId: parsed.parentId ?? null,
          scopeNotes: parsed.description ?? null,
        })
        .returning();
      invalidate(CACHE_TAGS.categories, CACHE_TAGS.taxonomyFamilies);
      return item;
    }
    case "themes": {
      const [item] = await db
        .insert(themes)
        .values({
          name: parsed.name,
          slug,
          level: 0,
          color: parsed.color ?? null,
          parentId: parsed.parentId ?? null,
        })
        .returning();
      invalidate(CACHE_TAGS.themes, CACHE_TAGS.taxonomyFamilies);
      return item;
    }
    case "literary-movements": {
      const [item] = await db
        .insert(literaryMovements)
        .values({
          name: parsed.name,
          slug,
          level: 0,
          color: parsed.color ?? null,
          parentId: parsed.parentId ?? null,
          scopeNotes: parsed.description ?? null,
        })
        .returning();
      invalidate(CACHE_TAGS.literaryMovements, CACHE_TAGS.taxonomyFamilies);
      return item;
    }
    case "art-types": {
      const [item] = await db
        .insert(artTypes)
        .values({ name: parsed.name, slug, description: parsed.description ?? null, color: parsed.color ?? null })
        .returning();
      invalidate(CACHE_TAGS.artTypes, CACHE_TAGS.taxonomyFamilies);
      return item;
    }
    case "art-movements": {
      const [item] = await db
        .insert(artMovements)
        .values({ name: parsed.name, slug, color: parsed.color ?? null })
        .returning();
      invalidate(CACHE_TAGS.artMovements, CACHE_TAGS.taxonomyFamilies);
      return item;
    }
    case "keywords": {
      const [item] = await db
        .insert(keywords)
        .values({ name: parsed.name, slug, color: parsed.color ?? null })
        .returning();
      invalidate(CACHE_TAGS.keywords, CACHE_TAGS.taxonomyFamilies);
      return item;
    }
    case "attributes": {
      const [item] = await db
        .insert(attributes)
        .values({ name: parsed.name, slug, description: parsed.description ?? null, color: parsed.color ?? null })
        .returning();
      invalidate(CACHE_TAGS.attributes, CACHE_TAGS.taxonomyFamilies);
      return item;
    }
  }
}

// ── Update Item ─────────────────────────────────────────────────────────────

export async function updateTaxonomyItem(familySlug: string, itemId: string, input: unknown) {
  const parsed = updateTaxonomyItemSchema.parse(input);
  const family = await getTaxonomyFamily(familySlug);
  if (!family) throw new Error(`Taxonomy family "${familySlug}" not found`);

  // If name changed, regenerate slug
  const slug = parsed.name ? slugify(parsed.name) : undefined;

  if (isSystemFamily(familySlug)) {
    return updateSystemItem(familySlug, itemId, parsed, slug);
  }

  // Custom family
  const values: Record<string, unknown> = {};
  if (parsed.name !== undefined) values.name = parsed.name;
  if (slug !== undefined) values.slug = slug;
  if (parsed.description !== undefined) values.description = parsed.description;
  if (parsed.color !== undefined) values.color = parsed.color;
  if (parsed.parentId !== undefined) values.parentId = parsed.parentId;

  const [updated] = await db
    .update(customTaxonomyItems)
    .set(values)
    .where(eq(customTaxonomyItems.id, itemId))
    .returning();

  invalidate(CACHE_TAGS.taxonomyFamilies, CACHE_TAGS.customTaxonomyItems);
  return updated;
}

async function updateSystemItem(
  familySlug: SystemFamilySlug,
  itemId: string,
  parsed: { name?: string; description?: string | null; color?: string | null; parentId?: string | null },
  slug?: string,
) {
  switch (familySlug) {
    case "subjects": {
      const values: Record<string, unknown> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (slug !== undefined) values.slug = slug;
      if (parsed.description !== undefined) values.description = parsed.description;
      if (parsed.color !== undefined) values.color = parsed.color;
      const [updated] = await db.update(subjects).set(values).where(eq(subjects.id, itemId)).returning();
      invalidate(CACHE_TAGS.subjects, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "genres": {
      const values: Record<string, unknown> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (slug !== undefined) values.slug = slug;
      if (parsed.color !== undefined) values.color = parsed.color;
      if (parsed.parentId !== undefined) values.parentId = parsed.parentId;
      const [updated] = await db.update(genres).set(values).where(eq(genres.id, itemId)).returning();
      invalidate(CACHE_TAGS.genres, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "tags": {
      const values: Record<string, unknown> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (slug !== undefined) values.slug = slug;
      if (parsed.color !== undefined) values.color = parsed.color;
      const [updated] = await db.update(tags).set(values).where(eq(tags.id, itemId)).returning();
      invalidate(CACHE_TAGS.tags, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "categories": {
      const values: Record<string, unknown> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (slug !== undefined) values.slug = slug;
      if (parsed.color !== undefined) values.color = parsed.color;
      if (parsed.parentId !== undefined) values.parentId = parsed.parentId;
      if (parsed.description !== undefined) values.scopeNotes = parsed.description;
      const [updated] = await db.update(bookCategories).set(values).where(eq(bookCategories.id, itemId)).returning();
      invalidate(CACHE_TAGS.categories, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "themes": {
      const values: Record<string, unknown> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (slug !== undefined) values.slug = slug;
      if (parsed.color !== undefined) values.color = parsed.color;
      if (parsed.parentId !== undefined) values.parentId = parsed.parentId;
      const [updated] = await db.update(themes).set(values).where(eq(themes.id, itemId)).returning();
      invalidate(CACHE_TAGS.themes, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "literary-movements": {
      const values: Record<string, unknown> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (slug !== undefined) values.slug = slug;
      if (parsed.color !== undefined) values.color = parsed.color;
      if (parsed.parentId !== undefined) values.parentId = parsed.parentId;
      if (parsed.description !== undefined) values.scopeNotes = parsed.description;
      const [updated] = await db.update(literaryMovements).set(values).where(eq(literaryMovements.id, itemId)).returning();
      invalidate(CACHE_TAGS.literaryMovements, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "art-types": {
      const values: Record<string, unknown> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (slug !== undefined) values.slug = slug;
      if (parsed.description !== undefined) values.description = parsed.description;
      if (parsed.color !== undefined) values.color = parsed.color;
      const [updated] = await db.update(artTypes).set(values).where(eq(artTypes.id, itemId)).returning();
      invalidate(CACHE_TAGS.artTypes, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "art-movements": {
      const values: Record<string, unknown> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (slug !== undefined) values.slug = slug;
      if (parsed.color !== undefined) values.color = parsed.color;
      const [updated] = await db.update(artMovements).set(values).where(eq(artMovements.id, itemId)).returning();
      invalidate(CACHE_TAGS.artMovements, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "keywords": {
      const values: Record<string, unknown> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (slug !== undefined) values.slug = slug;
      if (parsed.color !== undefined) values.color = parsed.color;
      const [updated] = await db.update(keywords).set(values).where(eq(keywords.id, itemId)).returning();
      invalidate(CACHE_TAGS.keywords, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "attributes": {
      const values: Record<string, unknown> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (slug !== undefined) values.slug = slug;
      if (parsed.description !== undefined) values.description = parsed.description;
      if (parsed.color !== undefined) values.color = parsed.color;
      const [updated] = await db.update(attributes).set(values).where(eq(attributes.id, itemId)).returning();
      invalidate(CACHE_TAGS.attributes, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
  }
}

// ── Delete Item ─────────────────────────────────────────────────────────────

export async function deleteTaxonomyItem(
  familySlug: string,
  itemId: string,
  reassignToId?: string,
) {
  const family = await getTaxonomyFamily(familySlug);
  if (!family) throw new Error(`Taxonomy family "${familySlug}" not found`);

  if (isSystemFamily(familySlug)) {
    if (reassignToId) {
      await reassignSystemJunctions(familySlug, itemId, reassignToId);
    }
    return deleteSystemItem(familySlug, itemId);
  }

  // Custom family — reassign junction records if needed
  if (reassignToId) {
    if (family.entityLevel === "work") {
      // Get existing target links to avoid duplicates
      const existingLinks = await db
        .select({ workId: customTaxonomyItemWorks.workId })
        .from(customTaxonomyItemWorks)
        .where(eq(customTaxonomyItemWorks.itemId, reassignToId));
      const existingWorkIds = new Set(existingLinks.map((r) => r.workId));

      const sourceLinks = await db
        .select({ workId: customTaxonomyItemWorks.workId })
        .from(customTaxonomyItemWorks)
        .where(eq(customTaxonomyItemWorks.itemId, itemId));

      const toInsert = sourceLinks
        .filter((r) => !existingWorkIds.has(r.workId))
        .map((r) => ({ itemId: reassignToId, workId: r.workId }));

      if (toInsert.length > 0) {
        await db.insert(customTaxonomyItemWorks).values(toInsert);
      }
    } else {
      const existingLinks = await db
        .select({ editionId: customTaxonomyItemEditions.editionId })
        .from(customTaxonomyItemEditions)
        .where(eq(customTaxonomyItemEditions.itemId, reassignToId));
      const existingEditionIds = new Set(existingLinks.map((r) => r.editionId));

      const sourceLinks = await db
        .select({ editionId: customTaxonomyItemEditions.editionId })
        .from(customTaxonomyItemEditions)
        .where(eq(customTaxonomyItemEditions.itemId, itemId));

      const toInsert = sourceLinks
        .filter((r) => !existingEditionIds.has(r.editionId))
        .map((r) => ({ itemId: reassignToId, editionId: r.editionId }));

      if (toInsert.length > 0) {
        await db.insert(customTaxonomyItemEditions).values(toInsert);
      }
    }
  }

  await db.delete(customTaxonomyItems).where(eq(customTaxonomyItems.id, itemId));
  invalidate(CACHE_TAGS.taxonomyFamilies, CACHE_TAGS.customTaxonomyItems);
  return { id: itemId };
}

async function deleteSystemItem(familySlug: SystemFamilySlug, itemId: string) {
  switch (familySlug) {
    case "subjects":
      await db.delete(subjects).where(eq(subjects.id, itemId));
      invalidate(CACHE_TAGS.subjects, CACHE_TAGS.taxonomyFamilies);
      break;
    case "genres":
      await db.delete(genres).where(eq(genres.id, itemId));
      invalidate(CACHE_TAGS.genres, CACHE_TAGS.taxonomyFamilies);
      break;
    case "tags":
      await db.delete(tags).where(eq(tags.id, itemId));
      invalidate(CACHE_TAGS.tags, CACHE_TAGS.taxonomyFamilies);
      break;
    case "categories":
      await db.delete(bookCategories).where(eq(bookCategories.id, itemId));
      invalidate(CACHE_TAGS.categories, CACHE_TAGS.taxonomyFamilies);
      break;
    case "themes":
      await db.delete(themes).where(eq(themes.id, itemId));
      invalidate(CACHE_TAGS.themes, CACHE_TAGS.taxonomyFamilies);
      break;
    case "literary-movements":
      await db.delete(literaryMovements).where(eq(literaryMovements.id, itemId));
      invalidate(CACHE_TAGS.literaryMovements, CACHE_TAGS.taxonomyFamilies);
      break;
    case "art-types":
      await db.delete(artTypes).where(eq(artTypes.id, itemId));
      invalidate(CACHE_TAGS.artTypes, CACHE_TAGS.taxonomyFamilies);
      break;
    case "art-movements":
      await db.delete(artMovements).where(eq(artMovements.id, itemId));
      invalidate(CACHE_TAGS.artMovements, CACHE_TAGS.taxonomyFamilies);
      break;
    case "keywords":
      await db.delete(keywords).where(eq(keywords.id, itemId));
      invalidate(CACHE_TAGS.keywords, CACHE_TAGS.taxonomyFamilies);
      break;
    case "attributes":
      await db.delete(attributes).where(eq(attributes.id, itemId));
      invalidate(CACHE_TAGS.attributes, CACHE_TAGS.taxonomyFamilies);
      break;
  }
  return { id: itemId };
}

// ── Merge Items ─────────────────────────────────────────────────────────────

export async function mergeTaxonomyItems(familySlug: string, input: unknown) {
  const { sourceId, targetId } = mergeTaxonomyItemsSchema.parse(input);
  const family = await getTaxonomyFamily(familySlug);
  if (!family) throw new Error(`Taxonomy family "${familySlug}" not found`);

  if (sourceId === targetId) throw new Error("Source and target must be different items");

  if (isSystemFamily(familySlug)) {
    await reassignSystemJunctions(familySlug, sourceId, targetId);
    await deleteSystemItem(familySlug, sourceId);
    return { sourceId, targetId };
  }

  // Custom family — move junction records then delete source
  if (family.entityLevel === "work") {
    const existingLinks = await db
      .select({ workId: customTaxonomyItemWorks.workId })
      .from(customTaxonomyItemWorks)
      .where(eq(customTaxonomyItemWorks.itemId, targetId));
    const existingWorkIds = new Set(existingLinks.map((r) => r.workId));

    const sourceLinks = await db
      .select({ workId: customTaxonomyItemWorks.workId })
      .from(customTaxonomyItemWorks)
      .where(eq(customTaxonomyItemWorks.itemId, sourceId));

    const toInsert = sourceLinks
      .filter((r) => !existingWorkIds.has(r.workId))
      .map((r) => ({ itemId: targetId, workId: r.workId }));

    if (toInsert.length > 0) {
      await db.insert(customTaxonomyItemWorks).values(toInsert);
    }

    // Remove source junction records
    await db.delete(customTaxonomyItemWorks).where(eq(customTaxonomyItemWorks.itemId, sourceId));
  } else {
    const existingLinks = await db
      .select({ editionId: customTaxonomyItemEditions.editionId })
      .from(customTaxonomyItemEditions)
      .where(eq(customTaxonomyItemEditions.itemId, targetId));
    const existingEditionIds = new Set(existingLinks.map((r) => r.editionId));

    const sourceLinks = await db
      .select({ editionId: customTaxonomyItemEditions.editionId })
      .from(customTaxonomyItemEditions)
      .where(eq(customTaxonomyItemEditions.itemId, sourceId));

    const toInsert = sourceLinks
      .filter((r) => !existingEditionIds.has(r.editionId))
      .map((r) => ({ itemId: targetId, editionId: r.editionId }));

    if (toInsert.length > 0) {
      await db.insert(customTaxonomyItemEditions).values(toInsert);
    }

    await db.delete(customTaxonomyItemEditions).where(eq(customTaxonomyItemEditions.itemId, sourceId));
  }

  // Delete source item
  await db.delete(customTaxonomyItems).where(eq(customTaxonomyItems.id, sourceId));
  invalidate(CACHE_TAGS.taxonomyFamilies, CACHE_TAGS.customTaxonomyItems);
  return { sourceId, targetId };
}

/** Move all junction records from sourceId to targetId for a system family, skipping duplicates. */
async function reassignSystemJunctions(
  familySlug: SystemFamilySlug,
  sourceId: string,
  targetId: string,
) {
  switch (familySlug) {
    case "subjects": {
      const existing = await db.select({ workId: workSubjects.workId }).from(workSubjects).where(eq(workSubjects.subjectId, targetId));
      const existingIds = new Set(existing.map((r) => r.workId));
      const source = await db.select({ workId: workSubjects.workId }).from(workSubjects).where(eq(workSubjects.subjectId, sourceId));
      const toInsert = source.filter((r) => !existingIds.has(r.workId)).map((r) => ({ subjectId: targetId, workId: r.workId }));
      if (toInsert.length > 0) await db.insert(workSubjects).values(toInsert);
      await db.delete(workSubjects).where(eq(workSubjects.subjectId, sourceId));
      break;
    }
    case "genres": {
      const existing = await db.select({ editionId: editionGenres.editionId }).from(editionGenres).where(eq(editionGenres.genreId, targetId));
      const existingIds = new Set(existing.map((r) => r.editionId));
      const source = await db.select({ editionId: editionGenres.editionId }).from(editionGenres).where(eq(editionGenres.genreId, sourceId));
      const toInsert = source.filter((r) => !existingIds.has(r.editionId)).map((r) => ({ genreId: targetId, editionId: r.editionId }));
      if (toInsert.length > 0) await db.insert(editionGenres).values(toInsert);
      await db.delete(editionGenres).where(eq(editionGenres.genreId, sourceId));
      break;
    }
    case "tags": {
      const existing = await db.select({ editionId: editionTags.editionId }).from(editionTags).where(eq(editionTags.tagId, targetId));
      const existingIds = new Set(existing.map((r) => r.editionId));
      const source = await db.select({ editionId: editionTags.editionId }).from(editionTags).where(eq(editionTags.tagId, sourceId));
      const toInsert = source.filter((r) => !existingIds.has(r.editionId)).map((r) => ({ tagId: targetId, editionId: r.editionId }));
      if (toInsert.length > 0) await db.insert(editionTags).values(toInsert);
      await db.delete(editionTags).where(eq(editionTags.tagId, sourceId));
      break;
    }
    case "categories": {
      const existing = await db.select({ workId: workCategories.workId }).from(workCategories).where(eq(workCategories.categoryId, targetId));
      const existingIds = new Set(existing.map((r) => r.workId));
      const source = await db.select({ workId: workCategories.workId }).from(workCategories).where(eq(workCategories.categoryId, sourceId));
      const toInsert = source.filter((r) => !existingIds.has(r.workId)).map((r) => ({ categoryId: targetId, workId: r.workId }));
      if (toInsert.length > 0) await db.insert(workCategories).values(toInsert);
      await db.delete(workCategories).where(eq(workCategories.categoryId, sourceId));
      break;
    }
    case "themes": {
      const existing = await db.select({ workId: workThemes.workId }).from(workThemes).where(eq(workThemes.themeId, targetId));
      const existingIds = new Set(existing.map((r) => r.workId));
      const source = await db.select({ workId: workThemes.workId }).from(workThemes).where(eq(workThemes.themeId, sourceId));
      const toInsert = source.filter((r) => !existingIds.has(r.workId)).map((r) => ({ themeId: targetId, workId: r.workId }));
      if (toInsert.length > 0) await db.insert(workThemes).values(toInsert);
      await db.delete(workThemes).where(eq(workThemes.themeId, sourceId));
      break;
    }
    case "literary-movements": {
      const existing = await db.select({ workId: workLiteraryMovements.workId }).from(workLiteraryMovements).where(eq(workLiteraryMovements.literaryMovementId, targetId));
      const existingIds = new Set(existing.map((r) => r.workId));
      const source = await db.select({ workId: workLiteraryMovements.workId }).from(workLiteraryMovements).where(eq(workLiteraryMovements.literaryMovementId, sourceId));
      const toInsert = source.filter((r) => !existingIds.has(r.workId)).map((r) => ({ literaryMovementId: targetId, workId: r.workId }));
      if (toInsert.length > 0) await db.insert(workLiteraryMovements).values(toInsert);
      await db.delete(workLiteraryMovements).where(eq(workLiteraryMovements.literaryMovementId, sourceId));
      break;
    }
    case "art-types": {
      const existing = await db.select({ workId: workArtTypes.workId }).from(workArtTypes).where(eq(workArtTypes.artTypeId, targetId));
      const existingIds = new Set(existing.map((r) => r.workId));
      const source = await db.select({ workId: workArtTypes.workId }).from(workArtTypes).where(eq(workArtTypes.artTypeId, sourceId));
      const toInsert = source.filter((r) => !existingIds.has(r.workId)).map((r) => ({ artTypeId: targetId, workId: r.workId }));
      if (toInsert.length > 0) await db.insert(workArtTypes).values(toInsert);
      await db.delete(workArtTypes).where(eq(workArtTypes.artTypeId, sourceId));
      break;
    }
    case "art-movements": {
      const existing = await db.select({ workId: workArtMovements.workId }).from(workArtMovements).where(eq(workArtMovements.artMovementId, targetId));
      const existingIds = new Set(existing.map((r) => r.workId));
      const source = await db.select({ workId: workArtMovements.workId }).from(workArtMovements).where(eq(workArtMovements.artMovementId, sourceId));
      const toInsert = source.filter((r) => !existingIds.has(r.workId)).map((r) => ({ artMovementId: targetId, workId: r.workId }));
      if (toInsert.length > 0) await db.insert(workArtMovements).values(toInsert);
      await db.delete(workArtMovements).where(eq(workArtMovements.artMovementId, sourceId));
      break;
    }
    case "keywords": {
      const existing = await db.select({ workId: workKeywords.workId }).from(workKeywords).where(eq(workKeywords.keywordId, targetId));
      const existingIds = new Set(existing.map((r) => r.workId));
      const source = await db.select({ workId: workKeywords.workId }).from(workKeywords).where(eq(workKeywords.keywordId, sourceId));
      const toInsert = source.filter((r) => !existingIds.has(r.workId)).map((r) => ({ keywordId: targetId, workId: r.workId }));
      if (toInsert.length > 0) await db.insert(workKeywords).values(toInsert);
      await db.delete(workKeywords).where(eq(workKeywords.keywordId, sourceId));
      break;
    }
    case "attributes": {
      const existing = await db.select({ workId: workAttributes.workId }).from(workAttributes).where(eq(workAttributes.attributeId, targetId));
      const existingIds = new Set(existing.map((r) => r.workId));
      const source = await db.select({ workId: workAttributes.workId }).from(workAttributes).where(eq(workAttributes.attributeId, sourceId));
      const toInsert = source.filter((r) => !existingIds.has(r.workId)).map((r) => ({ attributeId: targetId, workId: r.workId }));
      if (toInsert.length > 0) await db.insert(workAttributes).values(toInsert);
      await db.delete(workAttributes).where(eq(workAttributes.attributeId, sourceId));
      break;
    }
  }
}

// ── Reorder Items ───────────────────────────────────────────────────────────

export async function reorderTaxonomyItems(familySlug: string, ids: string[]) {
  const family = await getTaxonomyFamily(familySlug);
  if (!family) throw new Error(`Taxonomy family "${familySlug}" not found`);

  if (isSystemFamily(familySlug)) {
    await reorderSystemItems(familySlug, ids);
    return { success: true };
  }

  // Custom family
  await Promise.all(
    ids.map((id, index) =>
      db
        .update(customTaxonomyItems)
        .set({ sortOrder: index })
        .where(eq(customTaxonomyItems.id, id)),
    ),
  );
  invalidate(CACHE_TAGS.taxonomyFamilies, CACHE_TAGS.customTaxonomyItems);
  return { success: true };
}

async function reorderSystemItems(familySlug: SystemFamilySlug, ids: string[]) {
  // Only families with sortOrder can be reordered
  switch (familySlug) {
    case "genres":
      await Promise.all(ids.map((id, index) => db.update(genres).set({ sortOrder: index }).where(eq(genres.id, id))));
      invalidate(CACHE_TAGS.genres, CACHE_TAGS.taxonomyFamilies);
      break;
    case "categories":
      await Promise.all(ids.map((id, index) => db.update(bookCategories).set({ sortOrder: index }).where(eq(bookCategories.id, id))));
      invalidate(CACHE_TAGS.categories, CACHE_TAGS.taxonomyFamilies);
      break;
    case "themes":
      await Promise.all(ids.map((id, index) => db.update(themes).set({ sortOrder: index }).where(eq(themes.id, id))));
      invalidate(CACHE_TAGS.themes, CACHE_TAGS.taxonomyFamilies);
      break;
    case "literary-movements":
      await Promise.all(ids.map((id, index) => db.update(literaryMovements).set({ sortOrder: index }).where(eq(literaryMovements.id, id))));
      invalidate(CACHE_TAGS.literaryMovements, CACHE_TAGS.taxonomyFamilies);
      break;
    default:
      // Tables without sortOrder column — no-op
      break;
  }
}

// ── Move Item (reparent in hierarchical families) ───────────────────────────

export async function moveTaxonomyItem(
  familySlug: string,
  itemId: string,
  newParentId: string | null,
) {
  const family = await getTaxonomyFamily(familySlug);
  if (!family) throw new Error(`Taxonomy family "${familySlug}" not found`);
  if (!family.hierarchical) throw new Error(`Family "${familySlug}" is not hierarchical`);

  if (isSystemFamily(familySlug)) {
    return moveSystemItem(familySlug, itemId, newParentId);
  }

  // Custom family
  const [updated] = await db
    .update(customTaxonomyItems)
    .set({ parentId: newParentId })
    .where(eq(customTaxonomyItems.id, itemId))
    .returning();

  invalidate(CACHE_TAGS.taxonomyFamilies, CACHE_TAGS.customTaxonomyItems);
  return updated;
}

async function moveSystemItem(
  familySlug: SystemFamilySlug,
  itemId: string,
  newParentId: string | null,
) {
  switch (familySlug) {
    case "genres": {
      const [updated] = await db.update(genres).set({ parentId: newParentId }).where(eq(genres.id, itemId)).returning();
      invalidate(CACHE_TAGS.genres, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "categories": {
      const [updated] = await db.update(bookCategories).set({ parentId: newParentId }).where(eq(bookCategories.id, itemId)).returning();
      invalidate(CACHE_TAGS.categories, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "themes": {
      const [updated] = await db.update(themes).set({ parentId: newParentId }).where(eq(themes.id, itemId)).returning();
      invalidate(CACHE_TAGS.themes, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    case "literary-movements": {
      const [updated] = await db.update(literaryMovements).set({ parentId: newParentId }).where(eq(literaryMovements.id, itemId)).returning();
      invalidate(CACHE_TAGS.literaryMovements, CACHE_TAGS.taxonomyFamilies);
      return updated;
    }
    default:
      throw new Error(`System family "${familySlug}" does not support hierarchy`);
  }
}
