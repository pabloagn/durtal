import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { OPEN_JOB_STATUSES, SINGLE_VALUE_KINDS, sqlList } from "@/lib/enrichment/model";
import { resultRows, type Snapshot } from "./store";
import type { Row } from "./types";

/*
 * Book enrichment rows in a Harmonize merge (SLN-462). The merge executor
 * moves rows with a plain UPDATE; before that, rows the kept record already
 * has are folded into it, so no unique key or guard fails:
 * - a claim that repeats an open or accepted claim of the kept record is
 *   superseded by it;
 * - a value row that repeats one of the kept record goes (its claim was just
 *   superseded);
 * - a popularity snapshot of a month the kept book already has goes;
 * - an open job joins the kept book's open job of its kind, as
 *   enqueueEnrichmentJob does, and then goes.
 * Evidence does not move: its source records move with the merge.
 */

const OPEN = sql.raw(sqlList(OPEN_JOB_STATUSES));
/** The columns that make one claim's value */
const CLAIM_VALUE = ["edition_id", "term_id", "number_value", "text_value", "place_id", "person_id"];
const sameValue = (a: string, b: string, except: string) => {
  const columns = CLAIM_VALUE.filter((c) => c !== except);
  return sql.raw(
    `(${columns.map((c) => `${a}.${c}`).join(", ")}) is not distinct from (${columns.map((c) => `${b}.${c}`).join(", ")})`,
  );
};

/** Supersedes the merged record's claims that repeat a claim the kept record has */
function supersedeRepeats(column: "work_id" | "person_id" | "place_id", s: SQL, t: SQL) {
  // A work merge compares the value; a person or place merge compares the rest of the claim
  const rest = column === "work_id" ? sql`` : sql`and m.work_id = k.work_id`;
  return sql`update enrichment_claims m
    set status = 'superseded', superseded_by_claim_id = k.id, decided_by = 'check', decided_at = now()
    from enrichment_claims k
    where m.${sql.raw(column)} = ${s} and k.${sql.raw(column)} = ${t}
      and m.status in ('proposed', 'accepted') and k.status = m.status
      and k.dimension_id = m.dimension_id ${rest}
      and ${sameValue("m", "k", column)}`;
}

/**
 * The queries that move one enrichment table's references from the merged
 * record to the kept one, or undefined for a table this strategy does not own
 */
export function enrichmentMergeQueries(
  table: string,
  column: string,
  sourceId: string,
  targetId: string,
): SQL[] | undefined {
  const s = sql`${sourceId}::uuid`;
  const t = sql`${targetId}::uuid`;
  const key = `${table}.${column}`;
  switch (key) {
    case "enrichment_claims.work_id":
    case "enrichment_claims.person_id":
    case "enrichment_claims.place_id":
      return [
        supersedeRepeats(column as "work_id" | "person_id" | "place_id", s, t),
        sql`update enrichment_claims set ${sql.raw(column)} = ${t} where ${sql.raw(column)} = ${s}`,
      ];
    case "work_enrichment_values.work_id":
      return [
        sql`delete from work_enrichment_values m using work_enrichment_values k
          where m.work_id = ${s} and k.work_id = ${t} and m.dimension_id = k.dimension_id
          and m.number_value is not distinct from k.number_value and m.place_id is not distinct from k.place_id`,
        sql`update work_enrichment_values set work_id = ${t} where work_id = ${s}`,
      ];
    case "work_enrichment_values.place_id":
      return [
        sql`delete from work_enrichment_values m using work_enrichment_values k
          where m.place_id = ${s} and k.place_id = ${t} and m.work_id = k.work_id and m.dimension_id = k.dimension_id`,
        sql`update work_enrichment_values set place_id = ${t} where place_id = ${s}`,
      ];
    // A retired term follows its custom item (migration 0077 allows the move); a current one blocks the merge
    case "enrichment_terms.custom_item_id":
      return [sql`update enrichment_terms set custom_item_id = ${t} where custom_item_id = ${s}`];
    case "enrichment_applications.work_id":
      return [sql`update enrichment_applications set work_id = ${t} where work_id = ${s}`];
    case "work_popularity_snapshots.work_id":
      return [
        sql`delete from work_popularity_snapshots m using work_popularity_snapshots k
          where m.work_id = ${s} and k.work_id = ${t} and m.metric = k.metric and m.month = k.month`,
        sql`update work_popularity_snapshots set work_id = ${t} where work_id = ${s}`,
      ];
    case "enrichment_jobs.work_id":
      return [
        // The kept book's open job takes the merged one's dimensions and its earlier start
        sql`update enrichment_jobs k set
            payload = jsonb_set(k.payload, '{dimensions}', (
              select coalesce(jsonb_agg(distinct d order by d), '[]'::jsonb)
              from jsonb_array_elements_text(coalesce(k.payload -> 'dimensions', '[]'::jsonb) || coalesce(m.payload -> 'dimensions', '[]'::jsonb)) d
            )),
            run_after = least(k.run_after, m.run_after),
            rerun = k.rerun or k.status = 'running',
            updated_at = now()
          from enrichment_jobs m
          where m.work_id = ${s} and k.work_id = ${t} and m.kind = k.kind
            and m.status in (${OPEN}) and k.status in (${OPEN})`,
        sql`delete from enrichment_jobs m using enrichment_jobs k
          where m.work_id = ${s} and k.work_id = ${t} and m.kind = k.kind
            and m.status in (${OPEN}) and k.status in (${OPEN})`,
        sql`update enrichment_jobs set work_id = ${t} where work_id = ${s}`,
      ];
  }
  if (table.startsWith("enrichment_") || table === "work_enrichment_values" || table === "work_popularity_snapshots")
    throw new Error("This enrichment relationship requires a dedicated merge strategy");
  return undefined;
}

/** What the merge blockers need beyond the snapshot */
export interface EnrichmentMergeContext {
  /** Single-value dimensions that hold an accepted claim of either book, by id: their labels */
  singleValueDimensions: Record<string, string>;
  /** Of the two records, the taxonomy items a current term governs */
  governedItems: string[];
}

/** The Harmonize entities whose records a term may govern */
const TAXONOMY_ENTITIES = new Set([
  "subjects",
  "genres",
  "tags",
  "categories",
  "themes",
  "literary-movements",
  "art-types",
  "art-movements",
  "keywords",
  "attributes",
  "custom-taxonomy",
]);

export async function loadEnrichmentMergeContext(
  entityKey: string,
  ids: string[],
): Promise<EnrichmentMergeContext> {
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const context: EnrichmentMergeContext = { singleValueDimensions: {}, governedItems: [] };
  if (entityKey === "works") {
    const rows = resultRows<{ id: string; label: string }>(
      await db.execute(sql`select d.id, d.label from enrichment_dimensions d
        where d.value_kind in (${sql.raw(sqlList(SINGLE_VALUE_KINDS))})
        and exists (select 1 from enrichment_claims c where c.dimension_id = d.id and c.work_id in (${list}) and c.status = 'accepted')`),
    );
    for (const r of rows) context.singleValueDimensions[r.id] = r.label;
  }
  if (TAXONOMY_ENTITIES.has(entityKey)) {
    const rows = resultRows<{ id: string }>(
      await db.execute(sql`select coalesce(system_item_id, custom_item_id) as id from enrichment_terms
        where retired_in is null and (system_item_id in (${list}) or custom_item_id in (${list}))`),
    );
    context.governedItems = rows.map((r) => r.id);
  }
  return context;
}

/** The value of an accepted claim, to compare two books' values */
function claimValue(r: Row) {
  return JSON.stringify([r.term_id ?? null, r.number_value ?? null, r.text_value ?? null, r.place_id ?? null, r.person_id ?? null]);
}

/** Reasons a merge would break the enrichment model, written for Pablo */
export function enrichmentMergeBlockers(
  entityKey: string,
  source: Row,
  target: Row,
  snapshot: Snapshot,
  context?: EnrichmentMergeContext,
): string[] {
  const blockers: string[] = [];
  if (entityKey === "works") {
    const jobs = snapshot.references.enrichment_jobs || [];
    if (jobs.some((j) => j.work_id === source.id && j.status === "running"))
      blockers.push("An enrichment job is running for the book being merged away. Merge once it finishes.");
    const accepted = (snapshot.references.enrichment_claims || []).filter((c) => c.status === "accepted");
    for (const [dimensionId, label] of Object.entries(context?.singleValueDimensions ?? {})) {
      const of = (workId: unknown) => accepted.filter((c) => c.work_id === workId && c.dimension_id === dimensionId);
      const conflict = of(source.id).some((m) =>
        of(target.id).some((k) => (m.edition_id ?? null) === (k.edition_id ?? null) && claimValue(m) !== claimValue(k)),
      );
      if (conflict)
        blockers.push(`The two books have different accepted values for ${label}. Undo one of them before merging.`);
    }
  }
  if (TAXONOMY_ENTITIES.has(entityKey) && context?.governedItems.includes(String(source.id)))
    blockers.push(
      "The book enrichment vocabulary governs the item being merged away. Retire its term in a new vocabulary version first.",
    );
  return blockers;
}
