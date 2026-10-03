import { getTableName, sql } from "drizzle-orm";
import { z } from "zod";
import { getSystemRegistry } from "@/lib/db/taxonomy-resolver";
import type { Db } from "./work-store";

/** The book taxonomy families a work edit or the wizard can set, by input field. */
export const WORK_TAXONOMY_FIELDS = {
  subjectIds: "subjects",
  categoryIds: "categories",
  themeIds: "themes",
  literaryMovementIds: "literary-movements",
  artTypeIds: "art-types",
  artMovementIds: "art-movements",
  keywordIds: "keywords",
  attributeIds: "attributes",
} as const;

export type WorkTaxonomyInput = Partial<
  Record<keyof typeof WORK_TAXONOMY_FIELDS, string[]>
>;

/**
 * The writes that replace a book's items in each family the input names; a
 * family the input leaves out keeps its items. For one atomic batch.
 */
export function workTaxonomyQueries(
  d: Db,
  workId: string,
  input: WorkTaxonomyInput,
) {
  return Object.entries(WORK_TAXONOMY_FIELDS).flatMap(([field, slug]) => {
    const values = input[field as keyof typeof WORK_TAXONOMY_FIELDS];
    if (values === undefined) return [];
    const reg = getSystemRegistry(slug);
    const ids = [...new Set(z.array(z.uuid()).max(500).parse(values))];
    return [
      d.execute(
        sql`delete from ${reg.junction} where ${reg.junctionEntityCol}=${workId}::uuid`,
      ),
      ...(ids.length
        ? [
            d.execute(
              sql`insert into ${sql.identifier(getTableName(reg.junction))} (${sql.identifier(reg.junctionItemCol.name)},work_id) values ${sql.join(
                ids.map((id) => sql`(${id}::uuid,${workId}::uuid)`),
                sql`,`,
              )}`,
            ),
          ]
        : []),
    ];
  });
}
