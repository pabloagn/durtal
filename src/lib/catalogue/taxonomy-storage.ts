import { getTableName, sql, type SQL } from "drizzle-orm";
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
}
export function itemProjection(storage: TaxonomyStorage) {
  const optional = (column: string, fallback: SQL) =>
    storage.columns.has(column) ? sql`i.${sql.identifier(column)}` : fallback;
  return sql`i.id,i.name,i.slug,i.color,${optional("created_at", sql`null::timestamptz`)} as "createdAt",
    ${optional("description", optional("scope_notes", sql`null::text`))} as description,
    ${optional("parent_id", sql`null::uuid`)} as "parentId",${optional("sort_order", sql`0`)} as "sortOrder",${optional("level", sql`null::int`)} as level`;
}
export function linkedEntities(
  storage: TaxonomyStorage,
  familyId: string,
  kind: WorkKind = "book",
  itemId?: string,
) {
  return sql.join(
    storage.links.map(
      (link) => sql`
    select distinct l.${sql.identifier(link.owner)} as id, ${link.level}::text as level
    from ${sql.identifier(link.table)} l join ${sql.identifier(storage.table)} i on i.id=l.${sql.identifier(link.item)}
    ${link.level === "work" ? sql`join works w on w.id=l.work_id` : sql`join editions e on e.id=l.edition_id join works w on w.id=e.work_id`}
    where ${familyItemCondition(storage, familyId)} and w.kind=${kind} ${itemId ? sql`and i.id=${itemId}::uuid` : sql``}
  `,
    ),
    sql` union `,
  );
}
