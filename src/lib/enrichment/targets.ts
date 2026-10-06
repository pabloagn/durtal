import { sql, type SQL } from "drizzle-orm";
import { taxonomyStorage } from "@/lib/catalogue/taxonomy-storage";
import { assertSql } from "@/lib/harmonization/store";
import type { EnrichmentApplyTarget, EnrichmentValueKind } from "./model";
import { APPLY_TARGET_RULES, SINGLE_VALUE_KINDS } from "./model";

/*
 * Where an accepted value is written (SLN-462, section 5). Each target reads
 * the current value as JSON, says whether a value is already there, works out
 * the value after an apply, and writes and restores it with query builders
 * for one atomic batch. A target without a writer refuses with a reason.
 */

/** What a target needs to know about one claim */
export interface ApplyContext {
  claimId: string;
  workId: string;
  editionId: string | null;
  dimension: {
    id: string;
    valueKind: EnrichmentValueKind;
    applyTarget: EnrichmentApplyTarget;
    provider: string | null;
    family: { id: string; isSystem: boolean; systemTable: string | null } | null;
  };
  /** The governed item of the claim's term (taxonomy), or its work type */
  itemId: string | null;
  workTypeId: string | null;
  numberValue: number | null;
  textValue: string | null;
  placeId: string | null;
  personId: string | null;
}

export type TargetValue = Record<string, unknown>;
type Builder = { execute: (query: SQL) => unknown };

export interface ApplyTargetDefinition {
  kinds: readonly EnrichmentValueKind[];
  /** False until a later issue adds the writer */
  writer: boolean;
  /** A query whose one row has `value`: the target's current value as JSON */
  current(ctx: ApplyContext): SQL;
  /** A value is already there: a rule never replaces it */
  filled(current: TargetValue, ctx: ApplyContext): boolean;
  /** Refuses even Pablo's accept when a value is there (one ID per provider) */
  refuseFilled?: string;
  write(d: Builder, ctx: ApplyContext, current: TargetValue): unknown[];
  restore(d: Builder, ctx: ApplyContext, before: TargetValue, after: TargetValue): unknown[];
}

export class NoWriterError extends Error {}

const uuid = (id: string) => sql`${id}::uuid`;
const single = (ctx: ApplyContext) => SINGLE_VALUE_KINDS.includes(ctx.dimension.valueKind);

function links(ctx: ApplyContext) {
  if (!ctx.dimension.family) throw new Error("A taxonomy dimension names its family");
  const storage = taxonomyStorage(ctx.dimension.family);
  const link = storage.links.find((l) => l.level === "work")!;
  return { table: sql.identifier(link.table), item: sql.identifier(link.item) };
}
/** The items a current term of the claim's dimension governs */
const governed = (ctx: ApplyContext) =>
  sql`select coalesce(t.system_item_id, t.custom_item_id) from enrichment_terms t where t.dimension_id = ${uuid(ctx.dimension.id)} and t.retired_in is null`;

const taxonomy: ApplyTargetDefinition = {
  kinds: APPLY_TARGET_RULES.taxonomy.kinds,
  writer: true,
  current(ctx) {
    const { table, item } = links(ctx);
    return sql`select jsonb_build_object('items', coalesce(jsonb_agg(l.${item} order by l.${item}), '[]'::jsonb)) as value
      from ${table} l where l.work_id = ${uuid(ctx.workId)} and l.${item} in (${governed(ctx)})`;
  },
  filled: (current, ctx) =>
    single(ctx) ? (current.items as string[]).length > 0 : (current.items as string[]).includes(ctx.itemId!),
  write(d, ctx, current) {
    const { table, item } = links(ctx);
    const others = (current.items as string[]).filter((id) => id !== ctx.itemId);
    return [
      // A single-value dimension keeps one governed item per book
      ...(single(ctx) && others.length
        ? [d.execute(sql`delete from ${table} where work_id = ${uuid(ctx.workId)} and ${item} in (${sql.join(others.map(uuid), sql`, `)})`)]
        : []),
      d.execute(sql`insert into ${table} (${item}, work_id) values (${uuid(ctx.itemId!)}, ${uuid(ctx.workId)}) on conflict do nothing`),
    ];
  },
  restore(d, ctx, before, after) {
    const { table, item } = links(ctx);
    const was = before.items as string[];
    const now = after.items as string[];
    const added = now.filter((id) => !was.includes(id));
    const removed = was.filter((id) => !now.includes(id));
    return [
      ...(added.length
        ? [d.execute(sql`delete from ${table} where work_id = ${uuid(ctx.workId)} and ${item} in (${sql.join(added.map(uuid), sql`, `)})`)]
        : []),
      ...removed.map((id) =>
        d.execute(sql`insert into ${table} (${item}, work_id) values (${uuid(id)}, ${uuid(ctx.workId)}) on conflict do nothing`),
      ),
    ];
  },
};

type ValueRow = { id: string; number: number | null; place: string | null; claim: string };
const values: ApplyTargetDefinition = {
  kinds: APPLY_TARGET_RULES.values.kinds,
  writer: true,
  current: (ctx) =>
    sql`select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'number', v.number_value, 'place', v.place_id, 'claim', v.claim_id) order by v.id), '[]'::jsonb)) as value
      from work_enrichment_values v where v.work_id = ${uuid(ctx.workId)} and v.dimension_id = ${uuid(ctx.dimension.id)}`,
  filled: (current, ctx) => {
    const rows = current.rows as ValueRow[];
    return ctx.dimension.valueKind === "number" ? rows.length > 0 : rows.some((r) => r.place === ctx.placeId);
  },
  write(d, ctx, current) {
    const rows = current.rows as ValueRow[];
    return [
      ...(ctx.dimension.valueKind === "number" && rows.length
        ? [d.execute(sql`delete from work_enrichment_values where work_id = ${uuid(ctx.workId)} and dimension_id = ${uuid(ctx.dimension.id)}`)]
        : []),
      d.execute(sql`insert into work_enrichment_values (work_id, dimension_id, number_value, place_id, claim_id)
        values (${uuid(ctx.workId)}, ${uuid(ctx.dimension.id)}, ${ctx.numberValue}, ${ctx.placeId}, ${uuid(ctx.claimId)})`),
    ];
  },
  restore(d, ctx, before) {
    return [
      d.execute(sql`delete from work_enrichment_values where claim_id = ${uuid(ctx.claimId)}`),
      // A number's replaced row comes back; a place's rows were never touched
      ...(ctx.dimension.valueKind === "number" ? (before.rows as ValueRow[]) : []).map((r) =>
          d.execute(sql`insert into work_enrichment_values (id, work_id, dimension_id, number_value, place_id, claim_id)
            values (${uuid(r.id)}, ${uuid(ctx.workId)}, ${uuid(ctx.dimension.id)}, ${r.number}, ${r.place}, ${uuid(r.claim)})`),
        ),
    ];
  },
};

/** A works column: the value after an apply is the claim's */
function workColumn(column: string, value: (ctx: ApplyContext) => unknown): ApplyTargetDefinition {
  const target = `work.${column}` as EnrichmentApplyTarget;
  return {
    kinds: APPLY_TARGET_RULES[target].kinds,
    writer: true,
    current: (ctx) => sql`select jsonb_build_object('value', ${sql.identifier(column)}) as value from works where id = ${uuid(ctx.workId)}`,
    filled: (current) => current.value !== null && current.value !== undefined,
    write: (d, ctx) => [
      d.execute(sql`update works set ${sql.identifier(column)} = ${value(ctx)}, updated_at = now() where id = ${uuid(ctx.workId)}`),
    ],
    restore: (d, ctx, before) => [
      d.execute(sql`update works set ${sql.identifier(column)} = ${before.value ?? null}, updated_at = now() where id = ${uuid(ctx.workId)}`),
    ],
  };
}

/** The owner of an identifier: the book, or the edition of an edition-level dimension */
const identifierOwner = (ctx: ApplyContext) =>
  ctx.editionId
    ? { kind: "edition", column: sql`edition_id`, id: ctx.editionId }
    : { kind: "book", column: sql`work_id`, id: ctx.workId };

const identifier: ApplyTargetDefinition = {
  kinds: APPLY_TARGET_RULES.identifier.kinds,
  writer: true,
  current(ctx) {
    const owner = identifierOwner(ctx);
    return sql`select coalesce((select jsonb_build_object('id', i.id, 'externalId', i.external_id) from catalogue_identifiers i
      where i.entity_kind = ${owner.kind} and i.${owner.column} = ${uuid(owner.id)} and i.provider = ${ctx.dimension.provider}
      order by i.created_at, i.id limit 1), jsonb_build_object('id', null, 'externalId', null)) as value`;
  },
  filled: (current) => current.id !== null,
  refuseFilled: "This record already has an ID of this provider; undo it first",
  write(d, ctx) {
    const owner = identifierOwner(ctx);
    return [
      d.execute(sql`insert into catalogue_identifiers (entity_kind, ${owner.column}, provider, external_id)
        values (${owner.kind}, ${uuid(owner.id)}, ${ctx.dimension.provider}, ${ctx.textValue})
        on conflict (provider, entity_kind, external_id) do nothing`),
      d.execute(
        sql`select harmonization_assert(exists (select 1 from catalogue_identifiers where entity_kind = ${owner.kind} and ${owner.column} = ${uuid(owner.id)} and provider = ${ctx.dimension.provider} and external_id = ${ctx.textValue}), ${"This ID already belongs to another record"})`,
      ),
    ];
  },
  restore(d, ctx, _before, after) {
    const owner = identifierOwner(ctx);
    return [
      d.execute(sql`delete from catalogue_identifiers where entity_kind = ${owner.kind} and ${owner.column} = ${uuid(owner.id)}
        and provider = ${ctx.dimension.provider} and external_id = ${String(after.externalId)}`),
    ];
  },
};

/** The only edition columns an identity claim may fill (SLN-464) */
const EDITION_IDENTIFIER_COLUMNS = ["lccn"] as const;

/**
 * An edition's identifier column (SLN-464): the apply registers the edition's
 * identifier, with the identifier target's refusals, and fills the column
 * only while it is empty; a column that holds another value is kept, and
 * `after` shows it. A locked edition is refused. Undo removes the identifier,
 * and clears the column only when the apply filled it and it still holds the
 * value.
 */
function editionIdentifier(column: (typeof EDITION_IDENTIFIER_COLUMNS)[number]): ApplyTargetDefinition {
  if (!EDITION_IDENTIFIER_COLUMNS.includes(column)) throw new Error(`Refusing to write editions.${column}`);
  const col = sql.identifier(column);
  const edition = (ctx: ApplyContext) => uuid(ctx.editionId!);
  return {
    kinds: APPLY_TARGET_RULES[`edition.${column}`].kinds,
    writer: true,
    current: (ctx) =>
      sql`select jsonb_build_object('id', i.id, 'externalId', i.external_id, 'column', e.${col}) as value from editions e
        left join lateral (select id, external_id from catalogue_identifiers where entity_kind = 'edition' and edition_id = e.id
          and provider = ${ctx.dimension.provider} order by created_at, id limit 1) i on true
        where e.id = ${edition(ctx)}`,
    filled: identifier.filled,
    refuseFilled: identifier.refuseFilled,
    write: (d, ctx, current) => [
      d.execute(assertSql(sql`not (select metadata_locked from editions where id = ${edition(ctx)})`, "The edition is locked; unlock it first")),
      ...identifier.write(d, ctx, current),
      d.execute(sql`update editions set ${col} = ${ctx.textValue}, updated_at = now() where id = ${edition(ctx)} and ${col} is null`),
    ],
    restore: (d, ctx, before, after) => [
      ...identifier.restore(d, ctx, before, after),
      ...(before.column === null
        ? [d.execute(sql`update editions set ${col} = null, updated_at = now() where id = ${edition(ctx)} and ${col} = ${String(after.externalId)}`)]
        : []),
    ],
  };
}

function noWriter(target: EnrichmentApplyTarget, message = `No writer for ${target}`): ApplyTargetDefinition {
  const refuse = () => {
    throw new NoWriterError(message);
  };
  return {
    kinds: APPLY_TARGET_RULES[target].kinds,
    writer: false,
    current: refuse,
    filled: refuse,
    write: refuse,
    restore: refuse,
  };
}

export const APPLY_TARGETS: Record<EnrichmentApplyTarget, ApplyTargetDefinition> = {
  taxonomy,
  values,
  "work.work_type_id": workColumn("work_type_id", (ctx) => ctx.workTypeId),
  "work.original_title": workColumn("original_title", (ctx) => ctx.textValue),
  "work.original_language": workColumn("original_language", (ctx) => ctx.textValue),
  "work.original_year": workColumn("original_year", (ctx) => ctx.numberValue),
  identifier,
  none: noWriter("none", "Nothing is applied for a measurement"),
  "edition.open_library_key": noWriter("edition.open_library_key"),
  "edition.lccn": editionIdentifier("lccn"),
  "edition.oclc": noWriter("edition.oclc"),
  "edition.translator": noWriter("edition.translator"),
};

/** The target of a dimension, refusing one without a writer */
export function applyTarget(target: EnrichmentApplyTarget) {
  const definition = APPLY_TARGETS[target];
  if (!definition.writer) definition.current({} as ApplyContext);
  return definition;
}
