import { getTableName, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  getSystemRegistry,
  SYSTEM_FAMILY_SLUGS,
} from "@/lib/db/taxonomy-resolver";
import { customTaxonomyItems } from "@/lib/db/schema/taxonomy-families";
import type { WorkKind } from "./kinds";

type Family = { id: string; isSystem: boolean; systemTable: string | null };
export function taxonomyStorage(family: Family) {
  const key = SYSTEM_FAMILY_SLUGS.find(
    (slug) =>
      getTableName(getSystemRegistry(slug).table) === family.systemTable,
  );
  if (family.isSystem && key) {
    const reg = getSystemRegistry(key);
    return {
      table: getTableName(reg.table),
      columns: new Set(getTableConfig(reg.table).columns.map((c) => c.name)),
      entity: key,
      custom: false,
      links: [
        {
          table: getTableName(reg.junction),
          item: reg.junctionItemCol.name,
          owner: reg.junctionEntityCol.name,
          level: reg.junctionEntityCol.name === "work_id" ? "work" : "edition",
        },
      ],
    };
  }
  if (family.systemTable && family.systemTable !== "custom_taxonomy_items")
    throw new Error("Unknown taxonomy storage");
  return {
    table: "custom_taxonomy_items",
    columns: new Set(
      getTableConfig(customTaxonomyItems).columns.map((c) => c.name),
    ),
    entity: "custom-taxonomy",
    custom: true,
    links: [
      {
        table: "custom_taxonomy_item_works",
        item: "item_id",
        owner: "work_id",
        level: "work",
      },
      {
        table: "custom_taxonomy_item_editions",
        item: "item_id",
        owner: "edition_id",
        level: "edition",
      },
    ],
  };
}
export type TaxonomyStorage = ReturnType<typeof taxonomyStorage>;
/** Whether the family's items keep a description (Themes, Genres, Tags, Keywords and Art movements don't) */
export function storesDescription(storage: TaxonomyStorage) {
  return storage.columns.has("description") || storage.columns.has("scope_notes");
}
export function familyItemCondition(
  storage: TaxonomyStorage,
  familyId: string,
  alias = "i",
) {
  return storage.custom
    ? sql`${sql.identifier(alias)}.family_id=${familyId}::uuid`
    : sql`true`;
}
export interface TaxonomyItem {
  scopeNotes?: string | null;
  createdAt?: Date | string | null;
  id: string;
  name: string;
  slug: string | null;
  color: string | null;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  level: number | null;
  entityCount: number;
  /** All catalogue links, including scopes outside the visible count. */
  linkCount?: number;
  childCount?: number;
}
export function itemProjection(storage: TaxonomyStorage) {
  const optional = (column: string, fallback: SQL) =>
    storage.columns.has(column) ? sql`i.${sql.identifier(column)}` : fallback;
  return sql`i.id,i.name,i.slug,i.color,${optional("created_at", sql`null::timestamptz`)} as "createdAt",
    ${optional("description", optional("scope_notes", sql`null::text`))} as description,
    ${optional("parent_id", sql`null::uuid`)} as "parentId",${optional("sort_order", sql`0`)} as "sortOrder",${optional("level", sql`null::int`)} as level`;
}
/**
 * Work-level links kept outside the item tables, read for counts only: a
 * perfume's notes, and its formulations' notes and terms (SLN-886). Their
 * own editors write them.
 */
const PERFUME_LINKS = sql`select work_id,item_id from perfume_notes
  union select v.work_id,n.item_id from perfume_variant_notes n join perfume_variants v on v.id=n.variant_id
  union select v.work_id,t.item_id from perfume_variant_taxa t join perfume_variants v on v.id=t.variant_id`;

/**
 * Every link of a storage's items to works of the kinds given, as rows of
 * item_id, owner_id (a work or an edition), level and the work's kind
 */
export function linkRows(storage: TaxonomyStorage, kinds: readonly WorkKind[]) {
  const kindIn = sql`w.kind in (${sql.join(
    kinds.map((kind) => sql`${kind}`),
    sql`,`,
  )})`;
  const own = storage.links.map(
    (link) =>
      sql`select l.${sql.identifier(link.item)} as item_id,l.${sql.identifier(link.owner)} as owner_id,${link.level}::text as level,w.kind::text as kind from ${sql.identifier(link.table)} l ${link.level === "work" ? sql`join works w on w.id=l.work_id` : sql`join editions e on e.id=l.edition_id join works w on w.id=e.work_id`} where ${kindIn}`,
  );
  const perfume = storage.custom
    ? [sql`select l.item_id,l.work_id as owner_id,'work'::text as level,w.kind::text as kind from (${PERFUME_LINKS}) l join works w on w.id=l.work_id where ${kindIn}`]
    : [];
  return sql.join([...own, ...perfume], sql` union `);
}

export function linkedEntities(
  storage: TaxonomyStorage,
  familyId: string,
  kind: WorkKind = "book",
  itemId?: string,
) {
  return sql`select distinct l.owner_id as id, l.level
    from (${linkRows(storage, [kind])}) l join ${sql.identifier(storage.table)} i on i.id=l.item_id
    where ${familyItemCondition(storage, familyId)} ${itemId ? sql`and i.id=${itemId}::uuid` : sql``}`;
}

/**
 * SQL: the work holds the item, or one under it, in a built-in family stored
 * on works (Subjects, Themes, Keywords, Art types…), whatever its kind. The
 * film, perfume and painting lists filter by these as by their own families
 * (SLN-1157).
 */
export function systemWorkTaxonomyMatch(workId: SQL | AnyColumn, itemId: string) {
  const matches = SYSTEM_FAMILY_SLUGS.map(getSystemRegistry)
    .filter((reg) => reg.junctionEntityCol.name === "work_id")
    .map((reg) => {
      const table = getTableName(reg.table);
      const hierarchical = getTableConfig(reg.table).columns.some((c) => c.name === "parent_id");
      const items = hierarchical
        ? sql`(with recursive narrower(id) as (select ${itemId}::uuid union select i.id from ${sql.identifier(table)} i join narrower n on i.parent_id=n.id) select id from narrower)`
        : sql`(${itemId}::uuid)`;
      return sql`exists(select 1 from ${sql.identifier(getTableName(reg.junction))} j where j.work_id=${workId} and j.${sql.identifier(reg.junctionItemCol.name)} in ${items})`;
    });
  return sql`(${sql.join(matches, sql` or `)})`;
}
