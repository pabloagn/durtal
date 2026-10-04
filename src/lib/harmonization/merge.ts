import { randomUUID } from "node:crypto";
import { bookCreditMergeQueries } from "./book-credit-merge";
import { sql, type SQL } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { fieldLabel, entityDefinition } from "./registry";
import { recordRef, sameScope } from "./engine";
import { isBlank, stableStringify } from "./normalize";
import {
  assertSql,
  config,
  ident,
  loadSnapshot,
  lockSql,
  referencesTo,
  referenceWhere,
  resultRows,
  snapshotQuery,
  type Snapshot,
} from "./store";
import type { Dataset, MergeField, MergePreview, Row } from "./types";

const PROTECTED = new Set([
  "id",
  "kind",
  "slug",
  "created_at",
  "updated_at",
  "search_text",
  "total_orders",
  "total_spent",
  "last_order_date",
]);
const FIELD_GROUPS = [
  {
    key: "$cover_artwork",
    label: "Cover artwork",
    columns: ["cover_s3_key", "thumbnail_s3_key"],
  },
  {
    key: "$poster_artwork",
    label: "Poster artwork",
    columns: ["poster_s3_key", "thumbnail_s3_key"],
  },
  {
    key: "$coordinates",
    label: "Map position",
    columns: ["latitude", "longitude"],
  },
  {
    key: "$metadata_provenance",
    label: "Metadata provenance",
    columns: ["metadata_source", "metadata_source_id"],
  },
  {
    key: "$availability_assessment",
    label: "Availability assessment",
    columns: ["is_rare", "hunt_assessed_on"],
  },
];
export function mergeFields(source: Row, target: Row): MergeField[] {
  const groups = FIELD_GROUPS.filter((g) =>
    g.columns.every((key) => key in source && key in target),
  );
  const grouped = new Set(groups.flatMap((g) => g.columns));
  const fields = Object.keys(target)
    .filter(
      (key) =>
        !PROTECTED.has(key) &&
        !grouped.has(key) &&
        stableStringify(source[key]) !== stableStringify(target[key]) &&
        !isBlank(source[key]),
    )
    .map((key) => ({
      key,
      label: fieldLabel(key),
      source: source[key],
      target: target[key],
      conflict: !isBlank(target[key]),
    }));
  for (const group of groups) {
    const a = Object.fromEntries(
      group.columns.map((key) => [key, source[key]]),
    );
    const b = Object.fromEntries(
      group.columns.map((key) => [key, target[key]]),
    );
    if (
      group.columns.some((key) => !isBlank(source[key])) &&
      stableStringify(a) !== stableStringify(b)
    )
      fields.push({
        key: group.key,
        label: group.label,
        source: a,
        target: b,
        conflict: group.columns.some((key) => !isBlank(target[key])),
      });
  }
  return fields;
}
export function mergeBlockers(
  entityKey: string,
  source: Row,
  target: Row,
  snapshot: Snapshot,
): string[] {
  const entity = entityDefinition(entityKey);
  const blockers: string[] = [];
  if (entityKey === "works" && (source.kind !== "book" || target.kind !== "book"))
    blockers.push("Book harmonization can only merge books. Use the matching domain editor.");
  if (!entity.merge)
    blockers.push("These records require individual review in their editor.");
  if (!sameScope(entity, source, target))
    blockers.push(
      "These records belong to different contexts. Reconcile their parent, family, type or location before merging.",
    );
  if (
    entity.person &&
    !String(source.name).includes(",") &&
    String(target.name).includes(",")
  )
    blockers.push(
      "Keep the author name without a comma. Choose the other record as the survivor.",
    );
  if (source.parent_id === target.id || target.parent_id === source.id)
    blockers.push(
      "A parent and its child cannot be merged. Reconcile the hierarchy first.",
    );
  const targets = snapshot.references.acquisition_targets || [];
  const transformed: Row[] = targets
    .filter((r) => !r.is_cancelled)
    .map((r) => ({
      ...r,
      ...(entityKey === "works" ? { work_id: target.id } : {}),
      ...(entityKey === "publishers" && r.publisher_id === source.id
        ? { publisher_id: target.id }
        : {}),
    }));
  const identities = new Set<string>();
  for (const r of transformed) {
    const key = `${r.work_id}:${r.edition_id || ""}:${r.publisher_id || ""}`;
    if (identities.has(key))
      blockers.push(
        "Both records have the same active acquisition target. Reconcile or cancel one target before merging; existing orders and copies must retain their provenance.",
      );
    identities.add(key);
  }
  // A gallery layout is derived from media; it will be regenerated. All source data is archived.
  return [...new Set(blockers)];
}
export async function previewMerge(
  entityKey: string,
  sourceId: string,
  targetId: string,
): Promise<MergePreview> {
  if (sourceId === targetId) throw new Error("Choose two different records");
  const entity = entityDefinition(entityKey);
  const { data, fingerprint } = await loadSnapshot(entity.table, [
    sourceId,
    targetId,
  ]);
  const source = data.records.find((r) => r.id === sourceId),
    target = data.records.find((r) => r.id === targetId);
  if (!source || !target)
    throw new Error(
      "A record has changed or was removed. Scan the library again.",
    );
  const fields = mergeFields(source, target);
  await Promise.all(
    config(entity.table).foreignKeys.map(async (fk) => {
      const ref = fk.reference();
      const field = fields.find((f) => f.key === ref.columns[0].name);
      if (!field || ref.columns.length !== 1) return;
      const foreign = getTableConfig(ref.foreignTable);
      const labelsToTry = ["full_name", "name", "title", "code", "id"].filter(
        (name) => foreign.columns.some((c) => c.name === name),
      );
      const label = sql`coalesce(${sql.join(
        labelsToTry.map((name) => sql`nullif(${ident(name)}::text, '')`),
        sql`, `,
      )})`;
      const ids = [field.source, field.target].filter((v) => !isBlank(v));
      const labels = resultRows<{ id: string; label: string }>(
        await db.execute(
          sql`select id, ${label} as label from ${ident(foreign.name)} where id in (${sql.join(
            ids.map((id) => sql`${String(id)}::uuid`),
            sql`, `,
          )})`,
        ),
      );
      const display = (value: unknown) =>
        isBlank(value)
          ? null
          : labels.find((r) => r.id === value)?.label || "Unavailable record";
      field.display = {
        source: display(field.source),
        target: display(field.target),
      };
    }),
  );
  const context: Dataset = { [entity.table]: data.records };
  return {
    entity: entityKey,
    source: recordRef(entity, source, context),
    target: recordRef(entity, target, context),
    fingerprint,
    fields,
    blockers: mergeBlockers(entityKey, source, target, data),
    relationships: referencesTo(entity.table)
      .map((ref) => ({
        label: fieldLabel(ref.table),
        count: (data.references[ref.table] || []).filter((r) =>
          ref.columns.some((col) => r[col] === sourceId),
        ).length,
      }))
      .filter((r) => r.count > 0),
    sourceRecord: source,
    targetRecord: target,
  };
}
export function resolvedValues(
  source: Row,
  target: Row,
  choices: Record<string, "source" | "target">,
) {
  const fields = mergeFields(source, target);
  for (const key of Object.keys(choices))
    if (!fields.some((f) => f.key === key))
      throw new Error("An unknown merge field was submitted");
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.conflict && !choices[f.key])
      throw new Error(`Choose a value for ${f.label.toLowerCase()}`);
    if (!f.conflict || choices[f.key] === "source") {
      const group = FIELD_GROUPS.find((g) => g.key === f.key);
      if (group) Object.assign(values, f.source);
      else values[f.key] = f.source;
    }
  }
  return values;
}
function updateQuery(
  table: string,
  id: string,
  values: Record<string, unknown>,
) {
  const columns = config(table).columns;
  const pairs = Object.entries(values).map(([key, value]) => {
    const column = columns.find((c) => c.name === key);
    if (!column || column.generated || PROTECTED.has(key))
      throw new Error("Field cannot be edited through harmonization");
    // Populate through the PostgreSQL row type to correctly preserve arrays, JSON and dates.
    return sql`${ident(key)} = (jsonb_populate_record(null::${ident(table)}, ${JSON.stringify({ [key]: value })}::jsonb)).${ident(key)}`;
  });
  if (columns.some((c) => c.name === "updated_at"))
    pairs.push(sql`updated_at = now()`);
  return pairs.length
    ? sql`update ${ident(table)} set ${sql.join(pairs, sql`, `)} where id = ${id}::uuid`
    : sql`select 1`;
}
export { updateQuery };

export async function executeMerge(input: {
  entity: string;
  sourceId: string;
  targetId: string;
  fingerprint: string;
  choices: Record<string, "source" | "target">;
}) {
  const entity = entityDefinition(input.entity);
  const { data, fingerprint } = await loadSnapshot(entity.table, [
    input.sourceId,
    input.targetId,
  ]);
  if (fingerprint !== input.fingerprint)
    throw new Error(
      "The records or their relationships changed. Review a fresh merge preview.",
    );
  const source = data.records.find((r) => r.id === input.sourceId),
    target = data.records.find((r) => r.id === input.targetId);
  if (!source || !target || source.id === target.id)
    throw new Error("Choose two existing, different records");
  const blockers = mergeBlockers(input.entity, source, target, data);
  if (blockers.length) throw new Error(blockers[0]);
  const changes = resolvedValues(source, target, input.choices);
  if (
    entity.person &&
    !String(target.name).includes(",") &&
    String(changes.name || target.name).includes(",")
  )
    throw new Error("The canonical author name must not contain a comma");
  const refs = referencesTo(entity.table);
  const operationId = randomUUID();
  const foreignRefs = refs.filter((r) => !r.polymorphic);
  const queries: SQL[] = [
    sql`set local lock_timeout = '5s'`,
    sql`set local statement_timeout = '30s'`,
    lockSql([
      entity.table,
      ...refs.map((r) => r.table),
      "harmonization_operations",
      "harmonization_redirects",
      ...(input.entity === "works" || input.entity === "publishers"
        ? [
            "acquisition_target_copies",
            "instances",
            "orders",
            "editions",
            "edition_publishers",
          ]
        : []),
    ]),
    assertSql(
      sql`(select md5(data::text) = ${input.fingerprint} from (${snapshotQuery(entity.table, [source.id, target.id])}) s)`,
      "The records or their relationships changed. Review a fresh merge preview.",
    ),
    // Fail closed if a future migration introduces references the registry does not know about.
    assertSql(
      sql`not exists (select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute f on f.attrelid = c.confrelid and f.attnum = c.confkey[1]
      where c.contype = 'f' and c.confrelid = ${entity.table}::regclass
      and (cardinality(c.conkey) <> 1 or f.attname <> 'id' or not (${
        foreignRefs.length
          ? sql.join(
              foreignRefs.map(
                (r) =>
                  sql`(c.conrelid = ${r.table}::regclass and a.attname in (${sql.join(
                    r.columns.map((c) => sql`${c}`),
                    sql`, `,
                  )}))`,
              ),
              sql` or `,
            )
          : sql`false`
      }))
    )`,
      "A new relationship needs a merge strategy before this record can be merged.",
    ),
    sql`insert into harmonization_operations (id, action, entity, source_id, target_id, label, before) values (${operationId}::uuid, 'merge', ${input.entity}, ${source.id}::uuid, ${target.id}::uuid, ${`${source[entity.name]} → ${target[entity.name]}`}, ${JSON.stringify(data)}::jsonb)`,
    sql`select set_config('durtal.harmonization_operation', ${operationId}, true)`,
  ];
  // Retain target artwork as active; keep source artwork available in the media manager.
  if (entity.mediaOwner)
    queries.push(
      sql`update media s set is_active = false where s.${ident(entity.mediaOwner)} = ${source.id}::uuid and s.type in ('poster', 'background') and exists (select 1 from media t where t.${ident(entity.mediaOwner)} = ${target.id}::uuid and t.type = s.type and t.is_active)`,
    );
  // Editions must move before acquisition targets and orders. Guard functions recognize this audited merge only.
  const ordered = [...refs].sort((a, b) => {
    const order = (name: string) =>
      name === "editions"
        ? 0
        : name === "acquisition_targets"
          ? 1
          : name === "orders"
            ? 3
            : 2;
    return order(a.table) - order(b.table) || a.table.localeCompare(b.table);
  });
  for (const ref of ordered) {
    if (ref.table === "gallery_layouts") {
      queries.push(
        sql`delete from gallery_layouts where ${referenceWhere(ref, [source.id, target.id])}`,
      );
      continue;
    }
    const cfg = config(ref.table);
    const primary = [
      ...cfg.primaryKeys.flatMap((p) => p.columns),
      ...cfg.columns.filter((c) => c.primary),
    ];
    const junction =
      primary.length > 1 && primary.some((c) => ref.columns.includes(c.name));
    const creditQueries = ref.columns.length === 1
      ? bookCreditMergeQueries(ref.table, ref.columns[0], source.id, target.id)
      : undefined;
    if (creditQueries) {
      queries.push(...creditQueries);
    } else if (junction) {
      const columns = cfg.columns.filter((c) => !c.generated);
      const values = columns.map((c) =>
        ref.columns.includes(c.name)
          ? sql`case when ${ident(c.name)} = ${source.id}::uuid then ${target.id}::uuid else ${ident(c.name)} end`
          : ident(c.name),
      );
      queries.push(
        sql`insert into ${ident(ref.table)} (${sql.join(
          columns.map((c) => ident(c.name)),
          sql`, `,
        )}) select ${sql.join(values, sql`, `)} from ${ident(ref.table)} where ${referenceWhere(ref, [source.id])} on conflict (${sql.join(
          primary.map((c) => ident(c.name)),
          sql`, `,
        )}) do nothing`,
      );
      queries.push(
        sql`delete from ${ident(ref.table)} where ${referenceWhere(ref, [source.id])}`,
      );
    } else {
      queries.push(
        sql`update ${ident(ref.table)} set ${sql.join(
          ref.columns.map(
            (c) =>
              sql`${ident(c)} = case when ${ident(c)} = ${source.id}::uuid then ${target.id}::uuid else ${ident(c)} end`,
          ),
          sql`, `,
        )} where ${referenceWhere(ref, [source.id])}`,
      );
    }
  }
  if (entity.mediaOwner)
    queries.push(sql`update media set is_active = false where id in (
    select id from (select id, row_number() over (partition by type order by sort_order, created_at, id) as position from media where ${ident(entity.mediaOwner)} = ${target.id}::uuid and is_active and type in ('poster', 'background')) ranked where position > 1
  )`);
  if (input.entity === "publishers")
    queries.push(
      sql`insert into publisher_aliases (publisher_id, name) values (${target.id}::uuid, ${String(source.name)}) on conflict do nothing`,
    );
  queries.push(
    sql`update harmonization_redirects set target_id = ${target.id}::uuid where entity = ${input.entity} and target_id = ${source.id}::uuid`,
    sql`insert into harmonization_redirects (entity, source_id, source_slug, target_id) values (${input.entity}, ${source.id}::uuid, ${source.slug ? String(source.slug) : null}, ${target.id}::uuid)`,
    sql`delete from ${ident(entity.table)} where id = ${source.id}::uuid`,
    updateQuery(entity.table, target.id, changes),
  );
  // Venue counters are currency-blind legacy caches. Rebuild counts and date; never sum across currencies.
  if (input.entity === "venues")
    queries.push(
      sql`update venues set total_orders = (select count(*) from orders where venue_id = ${target.id}::uuid), last_order_date = (select max(order_date) from orders where venue_id = ${target.id}::uuid), total_spent = case when (select count(distinct currency) from orders where venue_id = ${target.id}::uuid) <= 1 then coalesce((select sum(total_cost) from orders where venue_id = ${target.id}::uuid), 0) else 0 end where id = ${target.id}::uuid`,
    );
  // One activity event per author merge, in the same transaction, for every
  // merge path (author page and Harmonize).
  if (input.entity === "authors")
    queries.push(
      sql`insert into activity_events (entity_type, entity_id, event_key, metadata) values ('author', ${target.id}::uuid, 'author.merged', ${JSON.stringify({ targetId: source.id, targetName: String(source.name ?? "") })}::jsonb)`,
    );
  queries.push(
    sql`select harmonization_validate_merge(${operationId}::uuid)`,
    sql`update harmonization_operations set after = (select data from (${snapshotQuery(entity.table, [target.id])}) s) where id = ${operationId}::uuid`,
  );
  await atomic((d) => queries.map((query) => d.execute(query)));
  return { operationId, targetId: target.id };
}
