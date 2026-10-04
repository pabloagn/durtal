import { sql, type SQL } from "drizzle-orm";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { CATALOGUE_DATE_REFERENCES } from "@/lib/catalogue/dates";
import { CONCENTRATION_LABELS } from "@/lib/catalogue/perfume-labels";
import { config, ident, type Snapshot } from "./store";
import type { Row } from "./types";

/**
 * Merging two works of one collection other than books. A film, perfume or
 * painting keeps its profile in a detail table keyed by the work (one row per
 * work), and its versions, copies, formulations, listings and objects hang
 * from that profile, not from the work. A merge keeps the kept work's profile
 * (with the values chosen in the preview), moves every row under the merged
 * one's profile to the kept one, and refuses pairs whose identities would
 * collide (two versions with one label, two formulations of one
 * concentration, two originals with one label).
 */
export const DETAIL_TABLES: Partial<Record<WorkKind, string>> = {
  film: "film_details",
  perfume: "perfume_details",
  painting: "painting_details",
};

/** The profile table of a work's collection; books have none */
export function detailTableOf(kind: unknown) {
  return DETAIL_TABLES[kind as WorkKind];
}

/**
 * Where a table moves in a merge: sources first (rows below them must cite
 * a source of the kept work), then the kept work's profile, then the rows
 * others point at (versions, formulations, objects), then everything else.
 * Books keep their order: editions, then acquisition targets, then the rest,
 * then orders.
 */
export function mergeOrder(table: string) {
  const order: Record<string, number> = {
    source_records: -2,
    catalogue_identifiers: -1,
    editions: 0,
    film_details: 0,
    perfume_details: 0,
    painting_details: 0,
    acquisition_targets: 1,
    film_versions: 1,
    perfume_variants: 1,
    art_objects: 1,
    orders: 3,
  };
  return order[table] ?? 2;
}

/**
 * Credits move to the kept work except those it already has (same role and
 * the same person, credited name or attribution): no film ends with its
 * director twice.
 */
export function workCreditMergeQueries(sourceId: string, targetId: string): SQL[] {
  return [
    sql`delete from work_credits s using work_credits t where s.work_id = ${sourceId}::uuid and t.work_id = ${targetId}::uuid
      and s.role_id = t.role_id and s.person_id is not distinct from t.person_id
      and coalesce(s.credited_as, '') = coalesce(t.credited_as, '')
      and s.attribution is not distinct from t.attribution`,
    sql`update work_credits set work_id = ${targetId}::uuid where work_id = ${sourceId}::uuid`,
  ];
}

/**
 * Gives the kept work a profile when only the merged one had one: a copy of
 * the merged work's profile. Rows under the merged profile then move to it.
 */
export function detailCopyQuery(detailTable: string, sourceId: string, targetId: string) {
  const columns = config(detailTable).columns.filter((c) => !c.generated);
  return sql`insert into ${ident(detailTable)} (${sql.join(
    columns.map((c) => ident(c.name)),
    sql`, `,
  )}) select ${sql.join(
    columns.map((c) => (c.name === "work_id" ? sql`${targetId}::uuid` : ident(c.name))),
    sql`, `,
  )} from ${ident(detailTable)} where work_id = ${sourceId}::uuid on conflict (work_id) do nothing`;
}

/** Sets the chosen values on the kept work's profile */
export function detailUpdateQuery(detailTable: string, workId: string, values: Record<string, unknown>) {
  const columns = config(detailTable).columns;
  const pairs = Object.entries(values).map(([key, value]) => {
    const column = columns.find((c) => c.name === key);
    if (!column || column.generated || key === "work_id")
      throw new Error("Field cannot be edited through harmonization");
    return sql`${ident(key)} = (jsonb_populate_record(null::${ident(detailTable)}, ${JSON.stringify({ [key]: value })}::jsonb)).${ident(key)}`;
  });
  return pairs.length
    ? sql`update ${ident(detailTable)} set ${sql.join(pairs, sql`, `)} where work_id = ${workId}::uuid`
    : undefined;
}

/**
 * Removes the profiles' dates no record points at after the merge: the
 * merged work's, and the kept work's when the merged one's was chosen.
 */
export function releasedDetailDatesQuery(detailTable: string, rows: Row[]) {
  const columns = CATALOGUE_DATE_REFERENCES.filter(([table]) => table === detailTable).map(([, column]) => column);
  const ids = [...new Set(rows.flatMap((r) => columns.map((c) => r[c])).filter((id): id is string => typeof id === "string"))];
  if (!ids.length) return undefined;
  const referenced = sql.join(
    CATALOGUE_DATE_REFERENCES.map(([table, column]) => sql`exists(select 1 from ${ident(table)} r where r.${ident(column)} = c.id)`),
    sql` or `,
  );
  return sql`delete from catalogue_dates c where c.id in (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}) and not (${referenced})`;
}

/** "Eau de Parfum Intense", or "with no concentration recorded" */
function formulationText(r: Row) {
  const concentration = r.concentration as string | null;
  const label = r.concentration_label as string | null;
  const base = concentration
    ? [CONCENTRATION_LABELS[concentration as keyof typeof CONCENTRATION_LABELS]?.label ?? concentration, label]
        .filter(Boolean)
        .join(" ")
    : (label ?? "with no concentration recorded");
  return r.formulation_label ? `${base} · ${r.formulation_label}` : base;
}

/**
 * What would collide if these two works merged: identities the database keeps
 * unique within one work, read from the merge snapshot. Each says what to do
 * first.
 */
export function domainMergeConflicts(kind: unknown, snapshot: Snapshot, sourceId: string, targetId: string): string[] {
  const domain = WORK_DOMAINS[kind as WorkKind];
  if (!domain || !detailTableOf(kind)) return [];
  const noun = domain.pluralLabel.toLowerCase();
  const rows = (table: string, workId: string) =>
    ((snapshot.references[table] || []) as Row[]).filter((r) => r.work_id === workId);
  /** Source rows whose identity a target row already has */
  const clashes = (table: string, identity: (r: Row) => string, include: (r: Row) => boolean = () => true) => {
    const kept = new Set(rows(table, targetId).filter(include).map(identity));
    return rows(table, sourceId).filter((r) => include(r) && kept.has(identity(r)));
  };
  const label = (r: Row) => String(r.label ?? "");
  if (kind === "film")
    return clashes("film_versions", label).map((r) =>
      r.label
        ? `Both ${noun} have a version labelled “${r.label}”. Rename or remove one of them first.`
        : `Both ${noun} have a version with no label. Label or remove one of them first.`,
    );
  if (kind === "perfume")
    return [
      ...clashes("perfume_variants", (r) =>
        JSON.stringify([r.concentration ?? null, r.concentration_label ?? null, r.formulation_label ?? null]),
      ).map((r) => `Both ${noun} have the formulation ${formulationText(r)}. Move its containers to one and remove the other first.`),
      ...clashes(
        "perfume_retailer_links",
        (r) => JSON.stringify([r.organization_id, r.venue_id ?? null, r.url]),
        (r) => r.variant_id == null,
      ).map((r) => `Both ${noun} list the retailer page ${r.url}. Remove one of the listings first.`),
    ];
  if (kind === "painting")
    return clashes("art_objects", label, (r) => r.kind !== "reproduction").map((r) =>
      r.label
        ? `Both ${noun} record an original or version labelled “${r.label}”. Relabel or remove one of them first.`
        : `Both ${noun} record an original or version with no label. Label one of them, or remove the duplicate, first.`,
    );
  return [];
}
