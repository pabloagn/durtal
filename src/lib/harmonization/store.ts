import { is, sql, type SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { ENTITIES, SCAN_COLUMNS } from "./registry";
import type { Dataset, Row } from "./types";

export const TABLES = new Map(
  (Object.values(schema) as unknown[])
    .filter((t): t is PgTable => is(t, PgTable))
    .map((t) => [getTableConfig(t).name, t]),
);
export function config(name: string) {
  const table = TABLES.get(name);
  if (!table) throw new Error("Unsupported catalogue table");
  return getTableConfig(table);
}
export const ident = (name: string) => sql.identifier(name);
export function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows: T[] }).rows;
}
const SCAN_TABLES = [
  ...new Set([
    ...ENTITIES.map((e) => e.table),
    "media",
    "work_authors",
    "edition_publishers",
    "ignored_publisher_names",
    "collection_editions",
    "collection_works",
    "taxonomy_families",
  ]),
];
const FILLED_TABLES = new Set(
  ENTITIES.filter((e) => e.duplicate).map((e) => e.table),
);
/**
 * The scan columns of one table. `_filled` counts the row's non-blank columns
 * (all of them) for `preferredRecord`.
 */
function scanFields(name: string) {
  const all = config(name).columns;
  const columns = all.map((c) => c.name);
  const keys = columns.filter((c) => SCAN_COLUMNS.includes(c));
  const values = keys.map((c) => sql`r.${ident(c)}`);
  if (FILLED_TABLES.has(name)) {
    // Same test as isBlank: null, or a string of only whitespace.
    const filled = all.map((c) => {
      const col = sql`r.${ident(c.name)}`;
      if (c.columnType === "PgText" || c.columnType === "PgVarchar")
        return sql`(${col} !~ '^\\s*$')`;
      if (c.columnType === "PgJsonb")
        return sql`(${col} is not null and not (jsonb_typeof(${col}) = 'string' and ${col} #>> '{}' ~ '^\\s*$'))`;
      return sql`(${col} is not null)`;
    });
    keys.push("_filled");
    values.push(
      sql`(${sql.join(
        filled.map((f) => sql`coalesce(${f}, false)::int`),
        sql` + `,
      )})`,
    );
  }
  return { keys, values, hasId: columns.includes("id") };
}
/**
 * One scanned table as a JSON array of rows. Rows keep the order of
 * `to_jsonb(r)::text`: with "id" as the shortest key and a C collation, that
 * is the id order. As arrays, rows do not repeat their column names.
 */
function scanTableSql(name: string, shape: "arrays" | "objects"): SQL {
  const { keys, values, hasId } = scanFields(name);
  const order = hasId ? sql`r.id` : sql`to_jsonb(r)::text`;
  const where =
    name === "works"
      ? sql`where r.kind = 'book'`
      : name === "authors"
        ? sql`where exists (select 1 from person_domains pd where pd.person_id = r.id and pd.kind = 'book')`
        : name === "publishing_houses"
          ? sql`where r.kind is not null`
          : name === "media"
            ? // The images the scan reads, of the books, people and
              // collections it scans: never a film's, perfume's, painting's,
              // publisher's or object's (SLN-887)
              sql`where r.collection_id is not null
                or exists (select 1 from works w where w.id = r.work_id and w.kind = 'book')
                or exists (select 1 from person_domains pd where pd.person_id = r.author_id and pd.kind = 'book')`
            : sql``;
  // jsonb_build_array and jsonb_build_object take at most 100 arguments.
  const parts: SQL[] = [];
  for (let i = 0; i < keys.length; i += 50)
    parts.push(
      shape === "arrays"
        ? sql`jsonb_build_array(${sql.join(values.slice(i, i + 50), sql`, `)})`
        : sql`jsonb_build_object(${sql.join(
            keys
              .slice(i, i + 50)
              .flatMap((k, j) => [sql`${k}::text`, values[i + j]]),
            sql`, `,
          )})`,
    );
  return sql`coalesce((select jsonb_agg(${sql.join(parts, sql` || `)} order by ${order}) from ${ident(name)} r ${where}), '[]'::jsonb)`;
}
/** The rows of one table exactly as `loadDataset` returns them, for assertions. */
export const scannedRowsSql = (name: string) => scanTableSql(name, "objects");
/**
 * The scan's films, perfumes and paintings: title, year, makers and links.
 * Makers and links are grouped once for all of them and joined by work, not
 * looked up per work: per-work lookups put the plan's cost past
 * `jit_above_cost` at about a thousand such works, and the JIT compile then
 * took longer than the read (SLN-887).
 */
const domainWorksSql = sql`coalesce((select jsonb_agg(jsonb_build_object(
    'id', w.id, 'kind', w.kind, 'title', w.title, 'slug', w.slug,
    'year', coalesce(fdd.start_year, pdd.start_year, adt.start_year),
    'makers', coalesce(credited.makers, '[]'::jsonb) || coalesce(houses.makers, '[]'::jsonb),
    'related', coalesce(linked.related, '[]'::jsonb)
  ) order by w.id)
  from works w
  left join film_details fd on fd.work_id = w.id left join catalogue_dates fdd on fdd.id = fd.release_date_id
  left join perfume_details pd on pd.work_id = w.id left join catalogue_dates pdd on pdd.id = pd.release_date_id
  left join painting_details ad on ad.work_id = w.id left join catalogue_dates adt on adt.id = ad.creation_date_id
  left join (select c.work_id, jsonb_agg(distinct jsonb_build_object(
        'key', coalesce(c.person_id::text, 'name:' || lower(btrim(c.credited_as))),
        'name', coalesce(a.name, btrim(c.credited_as)))) as makers
      from work_credits c left join authors a on a.id = c.person_id
      where c.role_id in ('film.director', 'painting.painter')
      and (c.person_id is not null or nullif(btrim(c.credited_as), '') is not null)
      group by c.work_id) credited on credited.work_id = w.id
  left join (select o.work_id, jsonb_agg(distinct jsonb_build_object('key', o.organization_id::text, 'name', p.name)) as makers
      from perfume_organizations o join publishing_houses p on p.id = o.organization_id
      where o.role in ('perfume_house', 'brand')
      group by o.work_id) houses on houses.work_id = w.id
  left join (select e.work_id, jsonb_agg(e.other order by e.other) as related
      from (select r.from_work_id as work_id, r.to_work_id as other from work_relations r
        union all select r.to_work_id, r.from_work_id from work_relations r where r.to_work_id <> r.from_work_id) e
      group by e.work_id) linked on linked.work_id = w.id
  where w.kind in ('film', 'perfume', 'painting')), '[]'::jsonb)`;
// A fingerprint is checked against a fresh database snapshot on every call.
// Unchanged scans need not transfer the same multi-megabyte catalogue again.
let previousDataset: { fingerprint: string; data: Dataset } | null = null;

export async function loadDataset(): Promise<Dataset> {
  const pairs = SCAN_TABLES.flatMap((name) => [
    sql`${name}::text`,
    scanTableSql(name, "arrays"),
  ]);
  const previous = previousDataset;
  const [row] = resultRows<{
    fingerprint: string; data: Record<string, unknown[][]> | null; domain_works: Row[] | null;
  }>(await db.execute(sql`
    with dataset as materialized (
      select jsonb_build_object(${sql.join(pairs, sql`, `)}) as data, ${domainWorksSql} as domain_works
    ), fingerprinted as materialized (
      select data, domain_works, encode(sha256(convert_to(data::text || domain_works::text, 'UTF8')), 'hex') as fingerprint from dataset
    )
    select fingerprint,
      case when fingerprint = ${previous?.fingerprint ?? null} then null else data end as data,
      case when fingerprint = ${previous?.fingerprint ?? null} then null else domain_works end as domain_works
    from fingerprinted
  `));
  if (previous && row.fingerprint === previous.fingerprint) return previous.data;
  if (!row.data || !row.domain_works) throw new Error("The catalogue scan is incomplete. Try again.");
  const rows = row.data;
  const data = Object.fromEntries([
    // Films, perfumes and paintings, for their duplicate check only
    ["domain_works", row.domain_works],
    ...SCAN_TABLES.map((name) => {
      const { keys } = scanFields(name);
      return [
        name,
        rows[name].map(
          (values) =>
            Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Row,
        ),
      ];
    }),
  ]);
  previousDataset = { fingerprint: row.fingerprint, data };
  return data;
}
export interface Reference {
  table: string;
  columns: string[];
  polymorphic?: string;
}
export function referencesTo(tableName: string): Reference[] {
  const refs: Reference[] = [];
  for (const [name] of TABLES) {
    const cols = config(name).foreignKeys.flatMap((fk) => {
      const ref = fk.reference();
      if (getTableConfig(ref.foreignTable).name !== tableName) return [];
      // A key on (id, kind) ties a row to a work of one kind (work_relations):
      // kind never changes, so the id column is the reference
      const foreign = ref.foreignColumns.map((c) => c.name);
      const kindTied =
        ref.columns.length === 2 && foreign[0] === "id" && foreign[1] === "kind";
      if (!kindTied && (ref.columns.length !== 1 || foreign[0] !== "id"))
        throw new Error("This relationship needs a dedicated merge strategy");
      return [ref.columns[0].name];
    });
    if (cols.length) refs.push({ table: name, columns: cols });
  }
  const type = (
    {
      works: "work",
      authors: "author",
      collections: "collection",
      publishing_houses: "organization",
      venues: "venue",
    } as Record<
      string,
      string
    >
  )[tableName];
  if (type)
    for (const name of ["activity_events", "comments", "gallery_layouts"])
      refs.push({ table: name, columns: ["entity_id"], polymorphic: type });
  return refs.sort((a, b) => a.table.localeCompare(b.table));
}
/** The profile tables of the collections other than books: one row per work */
export const DETAIL_TABLE_NAMES = ["film_details", "perfume_details", "painting_details"];
/**
 * The tables keyed to a profile table's `work_id`: a film's versions,
 * copies and companies, a perfume's formulations and listings, a painting's
 * objects. A merge of two works moves them with the work.
 */
export function referencesToDetail(detailTable: string): Reference[] {
  const refs: Reference[] = [];
  for (const [name] of TABLES) {
    const cols = config(name).foreignKeys.flatMap((fk) => {
      const ref = fk.reference();
      if (getTableConfig(ref.foreignTable).name !== detailTable) return [];
      if (ref.columns.length !== 1 || ref.foreignColumns[0].name !== "work_id")
        throw new Error("This relationship needs a dedicated merge strategy");
      return [ref.columns[0].name];
    });
    if (cols.length) refs.push({ table: name, columns: cols });
  }
  return refs.sort((a, b) => a.table.localeCompare(b.table));
}
/** Every table a merge of this table reads and moves: works add their profiles' tables */
export function mergeReferences(table: string): Reference[] {
  return [
    ...referencesTo(table),
    ...(table === "works" ? DETAIL_TABLE_NAMES.flatMap(referencesToDetail) : []),
  ];
}
export function referenceWhere(ref: Reference, ids: string[]): SQL {
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const columns = sql.join(
    ref.columns.map((c) => sql`${ident(c)} in (${list})`),
    sql` or `,
  );
  return sql`(${columns}) ${ref.polymorphic ? sql`and entity_type = ${ref.polymorphic}` : sql``}`;
}
export interface Snapshot {
  records: Row[];
  references: Record<string, Row[]>;
}
export function snapshotQuery(table: string, ids: string[]): SQL {
  const refs = mergeReferences(table);
  const pairs = refs.flatMap((ref) => [
    sql`${ref.table}::text`,
    sql`coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from ${ident(ref.table)} r where ${referenceWhere(ref, ids)}), '[]'::jsonb)`,
  ]);
  return sql`select jsonb_build_object(
    'records', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from ${ident(table)} r where id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})), '[]'::jsonb),
    'references', jsonb_build_object(${sql.join(pairs, sql`, `)})
  ) as data`;
}
export async function loadSnapshot(table: string, ids: string[]) {
  const query = snapshotQuery(table, ids);
  return resultRows<{ data: Snapshot; fingerprint: string }>(
    await db.execute(
      sql`select data, md5(data::text) as fingerprint from (${query}) s`,
    ),
  )[0];
}
export function assertSql(condition: SQL, message: string) {
  return sql`select harmonization_assert(${condition}, ${message})`;
}
/** Brief table locks also protect against writes from older editing screens. */
export function lockSql(tables: string[]) {
  return sql`lock table ${sql.join([...new Set(tables)].sort().map(ident), sql`, `)} in share row exclusive mode`;
}
// Once the migration has made them, the tables and the guard stay for the
// process's life: a yes is kept, so later checks cost no round trip (task 0613)
let persistenceReady = false;
export async function persistenceAvailable() {
  if (persistenceReady) return true;
  const rows = resultRows<{ ready: boolean }>(
    await db.execute(
      sql`select to_regclass('public.harmonization_operations') is not null and to_regprocedure('harmonization_assert(boolean,text)') is not null as ready`,
    ),
  );
  persistenceReady = rows[0].ready;
  return persistenceReady;
}
