import { getTableName, sql } from "drizzle-orm";
import { z } from "zod";
import { getSystemRegistry } from "@/lib/db/taxonomy-resolver";
import type { Db } from "./work-store";
import { governedEditQueries, readTaxonomyGovernance, type TaxonomyGovernance } from "@/lib/enrichment/governance";

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
 * The governed items (SLN-462) of the families an edit names, read before its
 * batch: pass the result to workTaxonomyQueries.
 */
export function readWorkTaxonomyGovernance(conn: Db, workId: string, input: WorkTaxonomyInput) {
  const families = Object.entries(WORK_TAXONOMY_FIELDS)
    .filter(([field]) => input[field as keyof typeof WORK_TAXONOMY_FIELDS] !== undefined)
    .map(([, slug]) => slug);
  return readTaxonomyGovernance(conn, workId, families);
}

/**
 * The writes that replace a book's items in each family the input names; a
 * family the input leaves out keeps its items. For one atomic batch. A
 * governed item added or removed by hand also records Pablo's claim and its
 * apply (SLN-462); `governance` is read first by readWorkTaxonomyGovernance.
 */
export function workTaxonomyQueries(
  d: Db,
  workId: string,
  input: WorkTaxonomyInput,
  governance?: TaxonomyGovernance,
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
      ...governedEditQueries(d, workId, slug, ids, governance),
    ];
  });
}
