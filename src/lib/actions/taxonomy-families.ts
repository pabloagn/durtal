"use server";

import { recordWorkChanges, workSnapshot } from "@/lib/activity/work-changes";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
  taxonomyScopesSchema,
  type CreateTaxonomyFamilyInput,
  type UpdateTaxonomyFamilyInput,
  createTaxonomyItemSchema,
  updateTaxonomyItemSchema,
  mergeTaxonomyItemsSchema,
} from "@/lib/validations/taxonomy-management";
import { slugify } from "@/lib/utils/slugify";
import { uniqueSlug } from "@/lib/catalogue/slugs";
import { withReadableErrors } from "@/lib/db/errors";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
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

/**
 * Families that apply to at least one enabled domain, with every scope they
 * have. Scopes of domains that are not enabled yet are kept, never shown.
 */
export const getTaxonomyFamilies = cached(
  async () => {
    const enabled = getEnabledWorkKinds();
    const families = await db
      .select()
      .from(taxonomyFamilies)
      .where(
        sql`exists(select 1 from taxonomy_applicability a where a.family_id=${taxonomyFamilies.id} and a.kind in (${sql.join(
          enabled.map((kind) => sql`${kind}`),
          sql`,`,
        )}))`,
      )
      .orderBy(asc(taxonomyFamilies.sortOrder), asc(taxonomyFamilies.name));
    const scopes = families.length
      ? await db
          .select()
          .from(taxonomyApplicability)
          .where(
            inArray(
              taxonomyApplicability.familyId,
              families.map((f) => f.id),
            ),
          )
      : [];
    return Promise.all(
      families.map(async (family) => {
        const storage = taxonomyStorage(family);
        const linked = sql.join(
          enabled.map(
            (kind) => sql`select id,level from (${linkedEntities(storage, family.id, kind)}) l`,
          ),
          sql` union all `,
        );
        const [row] = resultRows<{ itemCount: number; entityCount: number }>(
          await db.execute(sql`select
      (select count(*)::int from ${sql.identifier(storage.table)} i where ${familyItemCondition(storage, family.id)}) as "itemCount",
      (select count(*)::int from (${linked}) linked) as "entityCount"`),
        );
        return {
          ...family,
          ...row,
          scopes: scopes
            .filter((scope) => scope.familyId === family.id)
            .map(({ kind, level }) => ({ kind, level })),
        };
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
/** The family's scopes exactly as given; used scopes are protected in PostgreSQL. */
function writeScopes(
  d: typeof db,
  familyId: string,
  scopes: { kind: WorkKind; level: TaxonomyLevel }[],
) {
  return [
    d.execute(
      sql`delete from taxonomy_applicability where family_id=${familyId}::uuid and not (${sql.join(
        scopes.map((s) => sql`(kind=${s.kind} and level=${s.level})`),
        sql` or `,
      )})`,
    ),
    d
      .insert(taxonomyApplicability)
      .values(scopes.map((s) => ({ familyId, ...s })))
      .onConflictDoNothing(),
  ];
}
const FAMILY_NAME_TAKEN = "A taxonomy family with this name already exists";
const ITEM_NAME_TAKEN = "This family already has an item with this name";

/** A custom family and the scopes it applies to, in one transaction. */
export async function createTaxonomyFamily(input: CreateTaxonomyFamilyInput) {
  const { scopes, ...fields } = createTaxonomyFamilySchema.parse(input);
  const slug = await uniqueSlug(taxonomyFamilies, slugify(fields.name) || "family");
  const id = randomUUID();
  // The legacy level column follows the first book scope; scopes are the rule.
  const entityLevel =
    scopes.find((s) => s.kind === "book" && s.level === "edition") &&
    !scopes.some((s) => s.kind === "book" && s.level === "work")
      ? "edition"
      : "work";
  await withReadableErrors(
    () =>
      atomic((d) => [
        d.insert(taxonomyFamilies).values({
          id,
          ...fields,
          slug,
          entityLevel,
          isSystem: false,
          sortOrder: sql`(select coalesce(max(sort_order),-1)+1 from taxonomy_families)`,
        }),
        // An insert trigger adds a default book scope; keep only the chosen ones.
        ...writeScopes(d, id, scopes),
      ]),
    { unique: FAMILY_NAME_TAKEN },
  );
  changed();
  return (await getTaxonomyFamily(slug))!;
}
/**
 * Renames keep the URL. Fields and scopes change in one transaction; system
 * families keep their storage, hierarchy and scopes.
 */
export async function updateTaxonomyFamily(
  id: string,
  input: UpdateTaxonomyFamilyInput,
) {
  z.uuid().parse(id);
  const { scopes, ...fields } = updateTaxonomyFamilySchema.parse(input);
  if (!Object.keys(fields).length && !scopes)
    throw new Error("No editable fields supplied");
  await withReadableErrors(
    () =>
      atomic((d) => [
        d.execute(
          sql`select id from taxonomy_families where id=${id}::uuid for update`,
        ),
        d.execute(
          assertSql(
            sql`exists(select 1 from taxonomy_families where id=${id}::uuid)`,
            "Taxonomy family not found",
          ),
        ),
        ...(Object.keys(fields).length
          ? [
              d
                .update(taxonomyFamilies)
                .set(fields)
                .where(eq(taxonomyFamilies.id, id)),
            ]
          : []),
        ...(scopes
          ? [
              d.execute(
                assertSql(
                  sql`exists(select 1 from taxonomy_families where id=${id}::uuid and not is_system)`,
                  "Only custom families have editable applicability",
                ),
              ),
              ...writeScopes(d, id, scopes),
            ]
          : []),
      ]),
    { unique: FAMILY_NAME_TAKEN },
  );
  changed();
  return (await db.query.taxonomyFamilies.findFirst({
    where: eq(taxonomyFamilies.id, id),
    with: { applicability: true },
  }))!;
}
export async function setTaxonomyApplicability(id: string, input: unknown) {
  z.uuid().parse(id);
  const scopes = taxonomyScopesSchema.parse(input);
  await withReadableErrors(() =>
    atomic((d) => [
      d.execute(
        sql`select id from taxonomy_families where id=${id}::uuid for update`,
      ),
      d.execute(
        assertSql(
          sql`exists(select 1 from taxonomy_families where id=${id}::uuid and not is_system)`,
          "Only custom families have editable applicability",
        ),
      ),
      ...writeScopes(d, id, scopes),
    ]),
  );
  changed();
  return { id };
}
/**
 * What an editor must know before changing a family: its items, and which
 * scopes records use (those cannot be removed until reassigned).
 */
export async function getTaxonomyFamilyUsage(id: string) {
  z.uuid().parse(id);
  const family = await db.query.taxonomyFamilies.findFirst({
    where: eq(taxonomyFamilies.id, id),
  });
  if (!family) return null;
  const storage = taxonomyStorage(family);
  const [items] = resultRows<{ count: number }>(
    await db.execute(
      sql`select count(*)::int as count from ${sql.identifier(storage.table)} i where ${familyItemCondition(storage, family.id)}`,
    ),
  );
  const scopes = resultRows<{ kind: WorkKind; level: TaxonomyLevel; inUse: boolean }>(
    await db.execute(
      sql`select kind,level,taxonomy_scope_in_use(family_id,kind,level) as "inUse" from taxonomy_applicability where family_id=${id}::uuid order by kind,level`,
    ),
  );
  return {
    itemCount: items.count,
    scopes,
    deletable: !family.isSystem && scopes.every((scope) => !scope.inUse),
  };
}
/**
 * A custom family that no record uses goes with all its items. Families in use
 * and system families are refused, and nothing is changed.
 */
export async function deleteTaxonomyFamily(id: string) {
  z.uuid().parse(id);
  await withReadableErrors(() =>
    atomic((d) => [
      d.execute(
        sql`select id from taxonomy_families where id=${id}::uuid for update`,
      ),
      d.execute(
        assertSql(
          sql`exists(select 1 from taxonomy_families where id=${id}::uuid)`,
          "Taxonomy family not found",
        ),
      ),
      d.execute(
        assertSql(
          sql`exists(select 1 from taxonomy_families where id=${id}::uuid and not is_system)`,
          "System families cannot be deleted",
        ),
      ),
      d.execute(
        assertSql(
          sql`not exists(select 1 from taxonomy_applicability a where a.family_id=${id}::uuid and taxonomy_scope_in_use(a.family_id,a.kind,a.level))`,
          "Records still use this family; reassign or remove those classifications first",
        ),
      ),
      d.execute(
        sql`update custom_taxonomy_items set parent_id=null where family_id=${id}::uuid and parent_id is not null`,
      ),
      d.execute(sql`delete from custom_taxonomy_items where family_id=${id}::uuid`),
      d.delete(taxonomyFamilies).where(eq(taxonomyFamilies.id, id)),
    ]),
  );
  changed();
  return { id };
}
/**
 * The listed families take positions 0..n-1 in the given order. Families that
 * are not listed (for example those of collections that are not open yet)
 * follow them, keeping their relative order.
 */
export async function reorderFamilies(ids: string[]) {
  z.array(z.uuid()).min(1).max(500).parse(ids);
  if (new Set(ids).size !== ids.length)
    throw new Error("Each family must appear once");
  const listed = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`,`,
  );
  await withReadableErrors(() =>
    atomic((d) => [
      d.execute(lockSql(["taxonomy_families"])),
      d.execute(
        assertSql(
          sql`(select count(*) from taxonomy_families where id in (${listed}))=${ids.length}`,
          "A family in this order no longer exists; reload and try again",
        ),
      ),
      d.execute(
        sql`update taxonomy_families f set sort_order=${ids.length}+r.rank from (
          select id,row_number() over (order by sort_order,name,id)-1 as rank from taxonomy_families where id not in (${listed})
        ) r where f.id=r.id`,
      ),
      ...ids.map((id, sortOrder) =>
        d
          .update(taxonomyFamilies)
          .set({ sortOrder })
          .where(eq(taxonomyFamilies.id, id)),
      ),
    ]),
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
  await withReadableErrors(
    () =>
      db.execute(
        sql`insert into ${sql.identifier(storage.table)} (${sql.join(
          fields.map(([key]) => sql.identifier(key)),
          sql`,`,
        )}) values (${sql.join(
          fields.map(([, value]) => sql`${value}`),
          sql`,`,
        )})`,
      ),
    { unique: ITEM_NAME_TAKEN },
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
  // A rename to a name another item has is refused with the create's message
  const rows = resultRows<{ id: string }>(
    await withReadableErrors(
      () =>
        db.execute(
          sql`update ${sql.identifier(storage.table)} i set ${sql.join(
            fields.map(([key, value]) => sql`${sql.identifier(key)}=${value}`),
            sql`,`,
          )} where i.id=${itemId}::uuid and ${familyItemCondition(storage, family.id)} returning i.id`,
        ),
      { unique: ITEM_NAME_TAKEN },
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

const assignmentOwnerSchema = z.strictObject({
  kind: z.enum(WORK_KINDS),
  level: z.enum(["work", "edition"]),
  ownerId: z.uuid(),
});
export interface AssignedTaxonomyItem {
  id: string;
  name: string;
  parentName: string | null;
}
/**
 * Families a work or book edition can use, with the items it has. Only families
 * stored as custom items appear: built-in book families keep their own editors,
 * and positioned perfume notes have theirs.
 */
export async function getTaxonomyAssignments(
  input: z.input<typeof assignmentOwnerSchema>,
) {
  const { kind, level, ownerId } = assignmentOwnerSchema.parse(input);
  scopeSchema.parse({ kind, level });
  const families = (await getApplicableTaxonomyFamilies(kind, level))
    .map((row) => row.family)
    .filter((family) => taxonomyStorage(family).custom && family.slug !== "perfume-notes");
  if (!families.length) return [];
  const link =
    level === "work"
      ? sql`custom_taxonomy_item_works l on l.item_id=i.id and l.work_id=${ownerId}::uuid`
      : sql`custom_taxonomy_item_editions l on l.item_id=i.id and l.edition_id=${ownerId}::uuid`;
  const rows = resultRows<AssignedTaxonomyItem & { familyId: string }>(
    await db.execute(sql`select i.id,i.name,i.family_id as "familyId",p.name as "parentName"
      from custom_taxonomy_items i join ${link} left join custom_taxonomy_items p on p.id=i.parent_id
      where i.family_id in (${sql.join(
        families.map((f) => sql`${f.id}::uuid`),
        sql`,`,
      )}) order by lower(i.name),i.id`),
  );
  return families.map((family) => ({
    id: family.id,
    name: family.name,
    slug: family.slug,
    color: family.color,
    hierarchical: family.hierarchical,
    items: rows
      .filter((row) => row.familyId === family.id)
      .map(({ familyId: _family, ...item }) => item),
  }));
}
const itemSearchSchema = z.strictObject({
  query: z.string().trim().max(200).default(""),
  limit: z.number().int().min(1).max(50).default(20),
});
/**
 * At most `limit` items of one custom family, best matches first, plus
 * whether more exist. An empty query lists the family in its own order.
 */
export async function searchTaxonomyItems(
  familySlug: string,
  input: z.input<typeof itemSearchSchema> = {},
) {
  const { query, limit } = itemSearchSchema.parse(input);
  const family = await requiredFamily(familySlug);
  if (!taxonomyStorage(family).custom)
    throw new Error("This family is edited on its own page");
  const match = query
    ? sql`and search_normalize(i.name) like '%' || search_normalize(${query}) || '%'`
    : sql``;
  const order = query
    ? sql`order by (search_normalize(i.name)=search_normalize(${query})) desc,(search_normalize(i.name) like search_normalize(${query}) || '%') desc,lower(i.name),i.id`
    : sql`order by i.sort_order,lower(i.name),i.id`;
  const rows = resultRows<AssignedTaxonomyItem>(
    await db.execute(sql`select i.id,i.name,p.name as "parentName" from custom_taxonomy_items i
      left join custom_taxonomy_items p on p.id=i.parent_id
      where i.family_id=${family.id}::uuid ${match} ${order} limit ${limit + 1}`),
  );
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
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
  // A work's history notes each item added or removed
  const before = parsed.level === "work" ? await workSnapshot(parsed.ownerId) : null;
  // A refused change reaches the caller as its rule's message, never as SQL
  await withReadableErrors(() => atomic((d) => [
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
  ]));
  changed();
  if (before) await recordWorkChanges(parsed.ownerId, before, await workSnapshot(parsed.ownerId));
  return { ownerId: parsed.ownerId };
}
