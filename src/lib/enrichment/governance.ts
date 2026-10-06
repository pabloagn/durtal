import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { resultRows } from "@/lib/harmonization/store";
import { getSystemRegistry, type SystemFamilySlug } from "@/lib/db/taxonomy-resolver";
import { getTableName } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { APPLY_TARGETS, type ApplyContext } from "./targets";
import type { EnrichmentValueKind } from "./model";

/*
 * Hand edits of governed taxonomy items (SLN-462, section 5). When Pablo adds
 * an item a current term governs, it becomes his accepted human claim with
 * its apply, superseding an open proposal of that value; when he removes one,
 * its accepted claim is rejected (wrong_value, "removed by hand") with an
 * apply row, so the pipeline never proposes it again. Items no term governs
 * behave as before.
 */

export interface GovernedItem {
  family: SystemFamilySlug;
  itemId: string;
  termId: string;
  dimensionId: string;
  valueKind: EnrichmentValueKind;
  scaleValue: number | null;
  familyRow: { id: string; isSystem: boolean; systemTable: string | null };
  linked: boolean;
  accepted: { id: string; decidedBy: string | null; decidedAt: string | null; ruleId: string | null } | null;
  openProposals: { id: string }[];
}
export interface TaxonomyGovernance {
  version: number | null;
  items: GovernedItem[];
}

/** The governed items of the families an edit names, with the book's links and claims; read before the write */
export async function readTaxonomyGovernance(conn: Db, workId: string, families: SystemFamilySlug[]): Promise<TaxonomyGovernance> {
  if (!families.length) return { version: null, items: [] };
  const tables = families.map((f) => getTableName(getSystemRegistry(f).table));
  const [{ version }] = resultRows<{ version: number | null }>(await conn.execute(sql`select max(version) as version from enrichment_vocabulary_versions`));
  if (!version) return { version: null, items: [] };
  const rows = resultRows<Omit<GovernedItem, "family" | "linked"> & { systemTable: string }>(
    await conn.execute(sql`select t.system_item_id as "itemId", t.id as "termId", d.id as "dimensionId", d.value_kind as "valueKind",
        t.scale_value::float8 as "scaleValue", f.system_table as "systemTable",
        jsonb_build_object('id', f.id, 'isSystem', f.is_system, 'systemTable', f.system_table) as "familyRow",
        (select jsonb_build_object('id', c.id, 'decidedBy', c.decided_by, 'decidedAt', c.decided_at::text, 'ruleId', c.rule_id)
          from enrichment_claims c where c.work_id = ${workId}::uuid and c.term_id = t.id and c.status = 'accepted' order by c.decided_at desc limit 1) as accepted,
        coalesce((select jsonb_agg(jsonb_build_object('id', c.id) order by c.id) from enrichment_claims c
          where c.work_id = ${workId}::uuid and c.term_id = t.id and c.status = 'proposed'), '[]'::jsonb) as "openProposals"
      from enrichment_terms t join enrichment_dimensions d on d.id = t.dimension_id join taxonomy_families f on f.id = d.taxonomy_family_id
      where t.retired_in is null and d.retired_in is null and t.system_item_id is not null
        and f.system_table in (${sql.join(tables.map((t) => sql`${t}`), sql`, `)})`),
  );
  const items: GovernedItem[] = [];
  for (const r of rows) {
    const family = families.find((f) => getTableName(getSystemRegistry(f).table) === r.systemTable)!;
    const reg = getSystemRegistry(family);
    const [link] = resultRows<{ linked: boolean }>(
      await conn.execute(sql`select exists (select 1 from ${reg.junction} where ${reg.junctionEntityCol} = ${workId}::uuid and ${reg.junctionItemCol} = ${r.itemId}::uuid) as linked`),
    );
    items.push({ ...r, family, linked: link.linked });
  }
  return { version, items };
}

const context = (workId: string, claimId: string, item: GovernedItem): ApplyContext => ({
  claimId,
  workId,
  editionId: null,
  dimension: { id: item.dimensionId, valueKind: item.valueKind, applyTarget: "taxonomy", provider: null, family: item.familyRow },
  itemId: item.itemId,
  workTypeId: null,
  numberValue: item.scaleValue,
  textValue: null,
  placeId: null,
  personId: null,
});
const stateOf = (id: string, status: string, s?: { decidedBy: string | null; decidedAt: string | null; ruleId: string | null } | null) => ({
  id,
  status,
  decidedBy: s?.decidedBy ?? null,
  decidedAt: s?.decidedAt ?? null,
  ruleId: s?.ruleId ?? null,
  supersededByClaimId: null,
  decisionReason: null,
});

/**
 * The claim writes of one family's hand edit, for the batch that replaces its
 * links: run after the links are written. `ids` is the family's new item list.
 */
export function governedEditQueries(d: Db, workId: string, family: SystemFamilySlug, ids: string[], governance: TaxonomyGovernance | undefined): unknown[] {
  if (!governance?.version) return [];
  const queries: unknown[] = [];
  for (const item of governance.items.filter((i) => i.family === family)) {
    const kept = ids.includes(item.itemId);
    const currentAfter = (claimId: string): SQL => APPLY_TARGETS.taxonomy.current(context(workId, claimId, item));
    // The book's links to the dimension's governed items before the edit, as the taxonomy target reads them
    const linkedBefore = governance.items
      .filter((i) => i.dimensionId === item.dimensionId && i.linked)
      .map((i) => i.itemId)
      .sort();
    if (kept && !item.linked && !item.accepted) {
      const claimId = randomUUID();
      const before = { value: { items: linkedBefore }, claims: item.openProposals.map((p) => stateOf(p.id, "proposed")) };
      queries.push(
        d.execute(sql`insert into enrichment_claims (id, work_id, dimension_id, term_id, number_value, method, confidence, vocabulary_version, status, decided_by, decided_at, note)
          values (${claimId}::uuid, ${workId}::uuid, ${item.dimensionId}::uuid, ${item.termId}::uuid, ${item.valueKind === "scale" ? item.scaleValue : null}::numeric,
            'human', 1, ${governance.version}, 'accepted', 'pablo', now(), 'added by hand')`),
        ...(item.openProposals.length
          ? [
              d.execute(sql`update enrichment_claims set status = 'superseded', superseded_by_claim_id = ${claimId}::uuid, decided_by = 'pablo', decided_at = now()
                where id in (${sql.join(item.openProposals.map((p) => sql`${p.id}::uuid`), sql`, `)}) and status = 'proposed'`),
            ]
          : []),
        d.execute(sql`insert into enrichment_applications (claim_id, work_id, dimension_id, target, before, after, applied_by, note)
          values (${claimId}::uuid, ${workId}::uuid, ${item.dimensionId}::uuid, 'taxonomy', ${JSON.stringify(before)}::jsonb,
            jsonb_build_object('value', (select value from (${currentAfter(claimId)}) c)), 'pablo', 'added by hand')`),
      );
    }
    if (!kept && item.linked && item.accepted) {
      const before = { value: { items: linkedBefore }, claims: [stateOf(item.accepted.id, "accepted", item.accepted)] };
      queries.push(
        d.execute(sql`update enrichment_claims set status = 'rejected', decided_by = 'pablo', decided_at = now(), rule_id = null,
            decision_reason = 'wrong_value', note = 'removed by hand'
          where id = ${item.accepted.id}::uuid and status = 'accepted'`),
        d.execute(sql`insert into enrichment_applications (claim_id, work_id, dimension_id, target, before, after, applied_by, note)
          values (${item.accepted.id}::uuid, ${workId}::uuid, ${item.dimensionId}::uuid, 'taxonomy', ${JSON.stringify(before)}::jsonb,
            jsonb_build_object('value', (select value from (${currentAfter(item.accepted.id)}) c)), 'pablo', 'removed by hand')`),
      );
    }
  }
  return queries;
}
