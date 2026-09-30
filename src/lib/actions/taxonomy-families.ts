"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  taxonomyFamilies,
  taxonomyApplicability,
  works,
  editions,
} from "@/lib/db/schema";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";
import { WORK_KINDS, type WorkKind } from "@/lib/catalogue/kinds";
import {
  TAXONOMY_LEVELS,
  validTaxonomyScope,
  type TaxonomyLevel,
} from "@/lib/catalogue/taxonomies";
import {
  taxonomyStorage,
  familyItemCondition,
  itemProjection,
  linkedEntities,
  type TaxonomyItem,
} from "@/lib/catalogue/taxonomy-storage";
import {
  createTaxonomyFamilySchema,
  updateTaxonomyFamilySchema,
  createTaxonomyItemSchema,
  updateTaxonomyItemSchema,
  mergeTaxonomyItemsSchema,
} from "@/lib/validations/taxonomy-management";
import { slugify } from "@/lib/utils/slugify";
import { assertSql, resultRows, lockSql } from "@/lib/harmonization/store";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";

function changed() {
  invalidate(
    CACHE_TAGS.taxonomyFamilies,
    CACHE_TAGS.customTaxonomyItems,
    CACHE_TAGS.subjects,
    CACHE_TAGS.genres,
    CACHE_TAGS.tags,
    CACHE_TAGS.categories,
    CACHE_TAGS.themes,
    CACHE_TAGS.literaryMovements,
    CACHE_TAGS.artTypes,
    CACHE_TAGS.artMovements,
    CACHE_TAGS.keywords,
    CACHE_TAGS.attributes,
    CACHE_TAGS.works,
    CACHE_TAGS.editions,
  );
}
const scopeSchema = z
  .object({ kind: z.enum(WORK_KINDS), level: z.enum(TAXONOMY_LEVELS) })
  .refine(
    (s) => validTaxonomyScope(s.kind, s.level),
    "Invalid domain and record level",
  );

export async function getApplicableTaxonomyFamilies(
  kind: WorkKind,
  level: TaxonomyLevel = "work",
) {
  scopeSchema.parse({ kind, level });
  return db
    .select({ family: taxonomyFamilies })
    .from(taxonomyFamilies)
    .innerJoin(
      taxonomyApplicability,
      eq(taxonomyApplicability.familyId, taxonomyFamilies.id),
    )
    .where(
      and(
        eq(taxonomyApplicability.kind, kind),
        eq(taxonomyApplicability.level, level),
      ),
    )
    .orderBy(
      asc(taxonomyFamilies.sortOrder),
      asc(taxonomyFamilies.name),
      asc(taxonomyFamilies.id),
    );
}

/** Legacy directory stays book-scoped until the domain taxonomy UI is delivered. */
export const getTaxonomyFamilies = cached(
  async () => {
    const families = await db
      .select()
      .from(taxonomyFamilies)
      .where(
        sql`exists(select 1 from taxonomy_applicability a where a.family_id=${taxonomyFamilies.id} and a.kind='book')`,
      )
      .orderBy(asc(taxonomyFamilies.sortOrder), asc(taxonomyFamilies.name));
    return Promise.all(
      families.map(async (family) => {
        const storage = taxonomyStorage(family);
        const [row] = resultRows<{ itemCount: number; entityCount: number }>(
          await db.execute(sql`select
      (select count(*)::int from ${sql.identifier(storage.table)} i where ${familyItemCondition(storage, family.id)}) as "itemCount",
      (select count(*)::int from (${linkedEntities(storage, family.id)}) linked) as "entityCount"`),
        );
        return { ...family, ...row };
      }),
    );
  },
  ["taxonomy-families"],
  [CACHE_TAGS.taxonomyFamilies],
);

export async function getTaxonomyFamily(slug: string) {
  z.string().min(1).max(200).parse(slug);
  return (
    (await db.query.taxonomyFamilies.findFirst({
      where: eq(taxonomyFamilies.slug, slug),
      with: { applicability: true },
    })) ?? null
  );
}
async function requiredFamily(slug: string) {
  const family = await getTaxonomyFamily(slug);
  if (!family) throw new Error("Taxonomy family not found");
  return family;
}
export async function createTaxonomyFamily(input: unknown) {
  const parsed = createTaxonomyFamilySchema.parse(input);
  const [row] = await db
    .insert(taxonomyFamilies)
    .values({ ...parsed, isSystem: false })
    .returning();
  changed();
  return row;
}
export async function updateTaxonomyFamily(id: string, input: unknown) {
  z.uuid().parse(id);
  const parsed = updateTaxonomyFamilySchema.parse(input);
  const [row] = await db
    .update(taxonomyFamilies)
    .set(parsed)
    .where(eq(taxonomyFamilies.id, id))
    .returning();
  if (!row) throw new Error("Taxonomy family not found");
  changed();
  return row;
}
export async function setTaxonomyApplicability(id: string, input: unknown) {
  z.uuid().parse(id);
  const scopes = z.array(scopeSchema).min(1).max(20).parse(input);
  const unique = [
    ...new Map(scopes.map((s) => [`${s.kind}:${s.level}`, s])).values(),
  ];
  await atomic((d) => [
    d.execute(
      sql`select id from taxonomy_families where id=${id}::uuid for update`,
    ),
    d.execute(
      assertSql(
        sql`exists(select 1 from taxonomy_families where id=${id}::uuid and not is_system)`,
        "Only custom families have editable applicability",
      ),
    ),
    d.execute(
      sql`delete from taxonomy_applicability where family_id=${id}::uuid and not (${sql.join(
        unique.map((s) => sql`(kind=${s.kind} and level=${s.level})`),
        sql` or `,
      )})`,
    ),
    d
      .insert(taxonomyApplicability)
      .values(unique.map((s) => ({ familyId: id, ...s })))
      .onConflictDoNothing(),
  ]);
  changed();
  return { id };
}
export async function deleteTaxonomyFamily(id: string) {
  z.uuid().parse(id);
  const [row] = await db
    .delete(taxonomyFamilies)
    .where(eq(taxonomyFamilies.id, id))
    .returning({ id: taxonomyFamilies.id });
  if (!row) throw new Error("Taxonomy family not found");
  changed();
  return row;
}
export async function reorderFamilies(ids: string[]) {
  z.array(z.uuid()).max(500).parse(ids);
  if (new Set(ids).size !== ids.length)
    throw new Error("Each family must appear once");
  await atomic((d) =>
    ids.map((id, sortOrder) =>
      d
        .update(taxonomyFamilies)
        .set({ sortOrder })
        .where(eq(taxonomyFamilies.id, id)),
    ),
  );
  changed();
  return { success: true };
}

export async function getTaxonomyItems(
  familySlug: string,
  kind: WorkKind = "book",
) {
  z.enum(WORK_KINDS).parse(kind);
  const family = await getTaxonomyFamily(familySlug);
  if (!family) return [];
  const storage = taxonomyStorage(family);
  const counts = sql.join(
    storage.links.map(
      (link) =>
        sql`select l.${sql.identifier(link.item)} as item_id,l.${sql.identifier(link.owner)} as owner_id,${link.level}::text as level from ${sql.identifier(link.table)} l ${link.level === "work" ? sql`join works w on w.id=l.work_id` : sql`join editions e on e.id=l.edition_id join works w on w.id=e.work_id`} where w.kind=${kind}`,
    ),
    sql` union `,
  );
  return resultRows<TaxonomyItem>(
    await db.execute(
      sql`select ${itemProjection(storage)},coalesce(c.total,0)::int as "entityCount" from ${sql.identifier(storage.table)} i left join (select item_id,count(*) as total from (${counts}) links group by item_id) c on c.item_id=i.id where ${familyItemCondition(storage, family.id)} order by "sortOrder",lower(i.name),i.id`,
    ),
  );
}
export async function getTaxonomyItem(familySlug: string, itemSlug: string) {
  const family = await getTaxonomyFamily(familySlug);
  if (!family) return null;
  const storage = taxonomyStorage(family);
  const [item] = resultRows<TaxonomyItem>(
    await db.execute(
      sql`select ${itemProjection(storage)},0 as "entityCount" from ${sql.identifier(storage.table)} i where ${familyItemCondition(storage, family.id)} and i.slug=${itemSlug}`,
    ),
  );
  if (!item) return null;
  const rows = resultRows<{ id: string; level: string }>(
    await db.execute(linkedEntities(storage, family.id, "book", item.id)),
  );
  return {
    ...item,
    createdAt: storage.custom ? item.createdAt : undefined,
    entityIds: rows
      .filter((r) => r.level === family.entityLevel)
      .map((r) => r.id),
  };
}

export async function createTaxonomyItem(familySlug: string, input: unknown) {
  const parsed = createTaxonomyItemSchema.parse(input);
  const family = await requiredFamily(familySlug),
    storage = taxonomyStorage(family);
  if (
    parsed.parentId &&
    (!family.hierarchical || !storage.columns.has("parent_id"))
  )
    throw new Error("This family has no hierarchy");
  const id = randomUUID();
  const values: Record<string, unknown> = {
    id,
    name: parsed.name,
    slug: `${slugify(parsed.name) || "item"}-${id}`,
    color: parsed.color ?? null,
  };
  if (storage.custom) values.family_id = family.id;
  if (storage.columns.has("parent_id"))
    values.parent_id = parsed.parentId ?? null;
  if (storage.columns.has("level")) values.level = 1;
  if (storage.columns.has("description"))
    values.description = parsed.description ?? null;
  if (storage.columns.has("scope_notes"))
    values.scope_notes = parsed.description ?? null;
  const fields = Object.entries(values);
  await db.execute(
    sql`insert into ${sql.identifier(storage.table)} (${sql.join(
      fields.map(([key]) => sql.identifier(key)),
      sql`,`,
    )}) values (${sql.join(
      fields.map(([, value]) => sql`${value}`),
      sql`,`,
    )})`,
  );
  changed();
  return { id, ...parsed, slug: values.slug as string };
}
export async function updateTaxonomyItem(
  familySlug: string,
  itemId: string,
  input: unknown,
) {
  z.uuid().parse(itemId);
  const parsed = updateTaxonomyItemSchema.parse(input);
  const family = await requiredFamily(familySlug),
    storage = taxonomyStorage(family);
  if (
    parsed.parentId &&
    (!family.hierarchical || !storage.columns.has("parent_id"))
  )
    throw new Error("This family has no hierarchy");
  const values: Record<string, unknown> = {};
  if (parsed.name !== undefined) values.name = parsed.name;
  if (parsed.color !== undefined) values.color = parsed.color;
  if (parsed.parentId !== undefined && storage.columns.has("parent_id"))
    values.parent_id = parsed.parentId;
  if (parsed.description !== undefined) {
    if (storage.columns.has("description"))
      values.description = parsed.description;
    if (storage.columns.has("scope_notes"))
      values.scope_notes = parsed.description;
  }
  const fields = Object.entries(values);
  if (!fields.length) throw new Error("No editable fields supplied");
  const rows = resultRows<{ id: string }>(
    await db.execute(
      sql`update ${sql.identifier(storage.table)} i set ${sql.join(
        fields.map(([key, value]) => sql`${sql.identifier(key)}=${value}`),
        sql`,`,
      )} where i.id=${itemId}::uuid and ${familyItemCondition(storage, family.id)} returning i.id`,
    ),
  );
  if (!rows.length)
    throw new Error("Item does not belong to this taxonomy family");
  changed();
  return { id: itemId };
}
export async function mergeTaxonomyItems(familySlug: string, input: unknown) {
  const { sourceId, targetId } = mergeTaxonomyItemsSchema.parse(input);
  const family = await requiredFamily(familySlug),
    storage = taxonomyStorage(family);
  if (storage.custom) {
    const [row] = resultRows<{ total: number }>(
      await db.execute(
        sql`select count(*)::int as total from custom_taxonomy_items where family_id=${family.id}::uuid and id in (${sourceId}::uuid,${targetId}::uuid)`,
      ),
    );
    if (row.total !== 2)
      throw new Error("Choose two items from this taxonomy family");
  }
  const preview = await previewMerge(storage.entity, sourceId, targetId);
  const choices = Object.fromEntries(
    preview.fields
      .filter((f) => f.conflict)
      .map((f) => [f.key, "target" as const]),
  );
  await executeMerge({
    entity: storage.entity,
    sourceId,
    targetId,
    fingerprint: preview.fingerprint,
    choices,
  });
  changed();
  return { sourceId, targetId };
}
export async function deleteTaxonomyItem(
  familySlug: string,
  itemId: string,
  reassignToId?: string,
) {
  z.uuid().parse(itemId);
  if (reassignToId) {
    await mergeTaxonomyItems(familySlug, {
      sourceId: itemId,
      targetId: reassignToId,
    });
    return { id: itemId };
  }
  const family = await requiredFamily(familySlug),
    storage = taxonomyStorage(family);
  const rows = resultRows<{ id: string }>(
    await db.execute(
      sql`delete from ${sql.identifier(storage.table)} i where i.id=${itemId}::uuid and ${familyItemCondition(storage, family.id)} returning i.id`,
    ),
  );
  if (!rows.length)
    throw new Error("Item does not belong to this taxonomy family");
  changed();
  return { id: itemId };
}
export async function reorderTaxonomyItems(familySlug: string, ids: string[]) {
  z.array(z.uuid()).max(2000).parse(ids);
  if (new Set(ids).size !== ids.length)
    throw new Error("Each item must appear once");
  const family = await requiredFamily(familySlug),
    storage = taxonomyStorage(family);
  if (!storage.columns.has("sort_order"))
    throw new Error("This family uses alphabetical ordering");
  if (ids.length)
    await atomic((d) => [
      d.execute(lockSql([storage.table])),
      d.execute(
        assertSql(
          sql`(select count(*) from ${sql.identifier(storage.table)} i where ${familyItemCondition(storage, family.id)} and i.id in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`,`,
          )}))=${ids.length}`,
          "Item does not belong to this taxonomy family",
        ),
      ),
      ...ids.map((id, position) =>
        d.execute(
          sql`update ${sql.identifier(storage.table)} set sort_order=${position} where id=${id}::uuid`,
        ),
      ),
    ]);
  changed();
  return { success: true };
}
export async function moveTaxonomyItem(
  familySlug: string,
  itemId: string,
  newParentId: string | null,
) {
  z.uuid().nullable().parse(newParentId);
  const family = await requiredFamily(familySlug);
  if (!family.hierarchical) throw new Error("This family has no hierarchy");
  return updateTaxonomyItem(familySlug, itemId, { parentId: newParentId });
}

/** Typed work/edition adapters; future domain child tables use taxonomy_require_scope. */
export async function replaceTaxonomyAssignments(input: {
  familySlug: string;
  kind: WorkKind;
  level: "work" | "edition";
  ownerId: string;
  itemIds: string[];
}) {
  const parsed = z
    .object({
      familySlug: z.string().min(1).max(200),
      kind: z.enum(WORK_KINDS),
      level: z.enum(["work", "edition"]),
      ownerId: z.uuid(),
      itemIds: z.array(z.uuid()).max(500),
    })
    .parse(input);
  scopeSchema.parse(parsed);
  const family = await requiredFamily(parsed.familySlug),
    storage = taxonomyStorage(family);
  const link = storage.links.find((link) => link.level === parsed.level);
  if (!link)
    throw new Error("Taxonomy family has no assignment store at this level");
  const ids = [...new Set(parsed.itemIds)];
  const owner = parsed.level === "work" ? works : editions;
  await atomic((d) => [
    d.execute(
      sql`select id from ${owner} where id=${parsed.ownerId}::uuid for update`,
    ),
    d.execute(
      assertSql(
        parsed.level === "work"
          ? sql`exists(select 1 from works where id=${parsed.ownerId}::uuid and kind=${parsed.kind})`
          : sql`exists(select 1 from editions where id=${parsed.ownerId}::uuid)`,
        "Record not found in this domain",
      ),
    ),
    d.execute(
      sql`select taxonomy_require_scope(${family.id}::uuid,${parsed.kind}::work_kind_enum,${parsed.level})`,
    ),
    ...(ids.length
      ? [
          d.execute(
            assertSql(
              sql`(select count(*) from ${sql.identifier(storage.table)} i where ${familyItemCondition(storage, family.id)} and i.id in (${sql.join(
                ids.map((id) => sql`${id}::uuid`),
                sql`,`,
              )}))=${ids.length}`,
              "Item does not belong to this taxonomy family",
            ),
          ),
        ]
      : []),
    d.execute(
      sql`delete from ${sql.identifier(link.table)} l using ${sql.identifier(storage.table)} i where i.id=l.${sql.identifier(link.item)} and ${familyItemCondition(storage, family.id)} and l.${sql.identifier(link.owner)}=${parsed.ownerId}::uuid`,
    ),
    ...(ids.length
      ? [
          d.execute(
            sql`insert into ${sql.identifier(link.table)} (${sql.identifier(link.item)},${sql.identifier(link.owner)}) values ${sql.join(
              ids.map((id) => sql`(${id}::uuid,${parsed.ownerId}::uuid)`),
              sql`,`,
            )}`,
          ),
        ]
      : []),
  ]);
  changed();
  return { ownerId: parsed.ownerId };
}
