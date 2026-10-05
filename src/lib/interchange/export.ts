import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import { WORK_KINDS, type WorkKind } from "@/lib/catalogue/kinds";
import { fileRow, rowKey, type Row } from "./columns";
import {
  INTERCHANGE_FORMAT,
  INTERCHANGE_VERSION,
  type InterchangeDocument,
  type InterchangeRecord,
} from "./format";
import { RECORD_TABLES, SHARED_TABLES, TABLES, references, table, type Table } from "./tables";

/*
 * Export (SLN-375): the chosen works, each with every row the format
 * carries, and once each the shared rows they point at. Reads only.
 */

const CHUNK = 500;

/** A list of ids as a subquery, typed like the column it is compared with */
export function idList(ids: readonly string[], kind: "uuid" | "text" = "uuid"): SQL {
  const json = JSON.stringify(ids);
  return kind === "uuid"
    ? sql`(select value::uuid from jsonb_array_elements_text(${json}::jsonb))`
    : sql`(select value from jsonb_array_elements_text(${json}::jsonb))`;
}

/** Rows of a table whose column holds one of these values */
async function rowsWhere(t: Table, column: string, values: string[]): Promise<Row[]> {
  const out: Row[] = [];
  const kind = t.shape.columns.find((c) => c.name === column)!.kind === "uuid" ? "uuid" : "text";
  for (let i = 0; i < values.length; i += CHUNK) {
    const rows = resultRows<{ row: Row }>(
      await db.execute(
        sql`select to_jsonb(t) as row from ${sql.identifier(t.shape.name)} t where t.${sql.identifier(column)} in ${idList(values.slice(i, i + CHUNK), kind)}`,
      ),
    );
    out.push(...rows.map((r) => r.row));
  }
  return out;
}

/** The SQL that finds a record table's rows with the work that owns each */
function ownedRowsSql(t: Table, ids: string[]): SQL {
  const spec = t.spec;
  if (spec.mode !== "record") throw new Error(`${t.shape.name} is not a record table`);
  const name = sql.identifier(t.shape.name);
  if (spec.alsoParent) {
    // A source of a work, or of one of its editions
    const owner = sql`coalesce(t.${sql.identifier(spec.parent!.column)}, p.work_id)`;
    return sql`select ${owner} as owner, to_jsonb(t) as row from ${name} t
      left join ${sql.identifier(spec.alsoParent.table)} p on p.id = t.${sql.identifier(spec.alsoParent.column)}
      where ${owner} in ${idList(ids)}`;
  }
  if (!spec.parent) return sql`select t.id as owner, to_jsonb(t) as row from ${name} t where t.id in ${idList(ids)}`;
  const joins: SQL[] = [];
  let alias = "t";
  let current = spec;
  for (let i = 1; current.parent && current.parent.table !== "works"; i++) {
    const parent = table(current.parent.table);
    const next = `p${i}`;
    joins.push(
      sql`join ${sql.identifier(parent.shape.name)} ${sql.identifier(next)} on ${sql.identifier(next)}.${sql.identifier(parent.shape.primaryKey[0])} = ${sql.identifier(alias)}.${sql.identifier(current.parent.column)}`,
    );
    alias = next;
    if (parent.spec.mode !== "record") throw new Error(`${parent.shape.name} is not a record table`);
    current = parent.spec;
  }
  const owner = sql`${sql.identifier(alias)}.${sql.identifier(current.parent!.column)}`;
  return sql`select ${owner} as owner, to_jsonb(t) as row from ${name} t ${sql.join(joins, sql` `)} where ${owner} in ${idList(ids)}`;
}

type Bag = Map<string, Map<string, Row>>;
const put = (bag: Bag, t: Table, row: Row) => {
  const rows = bag.get(t.shape.name) ?? new Map<string, Row>();
  rows.set(rowKey(t.shape, row), row);
  bag.set(t.shape.name, rows);
};

/** The values a bag's rows hold in foreign keys to a table */
function citedIds(bag: Bag, target: string): Set<string> {
  const out = new Set<string>();
  for (const [name, rows] of bag) {
    const refs = references(table(name)).filter((r) => r.table === target);
    for (const row of rows.values())
      for (const ref of refs) if (row[ref.column] !== null && row[ref.column] !== undefined) out.add(String(row[ref.column]));
  }
  return out;
}

/** Adds to each bag the rows of these tables it cites, until nothing new is cited */
async function closeOver(bags: Bag[], targets: Table[]) {
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of targets) {
      const wanted = bags.map((bag) => {
        const have = bag.get(t.shape.name);
        return [...citedIds(bag, t.shape.name)].filter((id) => !have?.has(id));
      });
      const missing = [...new Set(wanted.flat())];
      if (!missing.length) continue;
      const found = new Map((await rowsWhere(t, t.shape.primaryKey[0], missing)).map((row) => [String(row[t.shape.primaryKey[0]]), row]));
      bags.forEach((bag, i) => {
        for (const id of wanted[i]) {
          const row = found.get(id);
          if (row) {
            put(bag, t, row);
            changed = true;
          }
        }
      });
    }
  }
}

export interface ExportSelection {
  /** These works only; every work of the chosen collections when absent */
  ids?: readonly string[] | null;
  /** These collections only; every open collection when absent */
  domains?: readonly WorkKind[] | null;
}

/** The works chosen, by collection and title */
async function chosenWorks(selection: ExportSelection) {
  const domains = (selection.domains?.length ? selection.domains : WORK_KINDS).filter((d) => WORK_DOMAINS[d].enabled);
  if (!domains.length) return [];
  return resultRows<{ id: string; kind: WorkKind; title: string }>(
    await db.execute(sql`select id, kind::text as kind, title from works
      where kind::text in ${idList(domains, "text")}
      ${selection.ids ? sql`and id in ${idList([...selection.ids])}` : sql``}
      order by kind, lower(title), id`),
  );
}

const sorted = (t: Table, rows: Iterable<Row>) =>
  [...rows].map((row) => fileRow(t.shape, row)).sort((a, b) => rowKey(t.shape, a).localeCompare(rowKey(t.shape, b)));

/** The interchange document of the chosen works */
export async function exportInterchange(selection: ExportSelection = {}): Promise<InterchangeDocument> {
  const works = await chosenWorks(selection);
  const records: { id: string; domain: WorkKind; title: string; bag: Bag }[] = [];
  const owned = RECORD_TABLES.filter((t) => t.spec.mode === "record" && (t.spec.parent || t.shape.name === "works"));
  const referenced = RECORD_TABLES.filter((t) => t.spec.mode === "record" && t.spec.referenced);

  for (let at = 0; at < works.length; at += CHUNK) {
    const chunk = works.slice(at, at + CHUNK);
    const byId = new Map(chunk.map((w) => [w.id, { id: w.id, domain: w.kind, title: w.title, bag: new Map() as Bag }]));
    for (const t of owned) {
      const rows = resultRows<{ owner: string; row: Row }>(await db.execute(ownedRowsSql(t, [...byId.keys()])));
      for (const { owner, row } of rows) put(byId.get(owner)!.bag, t, row);
    }
    const bags = [...byId.values()].map((r) => r.bag);
    // Dates and sources a row cites travel with the record that cites them
    await closeOver(bags, referenced);
    records.push(...byId.values());
  }

  // Shared rows: what the records cite, what those rows cite, and their parts
  const shared: Bag = new Map();
  const everything = () => [...records.map((r) => r.bag), shared];
  const entities = SHARED_TABLES.filter((t) => t.spec.mode === "entity");
  const parts = SHARED_TABLES.filter((t) => t.spec.mode === "part");
  for (let changed = true; changed; ) {
    const before = [...shared.values()].reduce((n, rows) => n + rows.size, 0);
    for (const t of entities) {
      const missing = new Set<string>();
      for (const bag of everything()) for (const id of citedIds(bag, t.shape.name)) if (!shared.get(t.shape.name)?.has(id)) missing.add(id);
      if (missing.size) for (const row of await rowsWhere(t, t.shape.primaryKey[0], [...missing])) put(shared, t, row);
    }
    for (const t of parts) {
      if (t.spec.mode !== "part") continue;
      const owners = [...(shared.get(t.spec.parent.table)?.keys() ?? [])];
      if (owners.length) for (const row of await rowsWhere(t, t.spec.parent.column, owners)) put(shared, t, row);
    }
    changed = [...shared.values()].reduce((n, rows) => n + rows.size, 0) !== before;
  }

  const out: InterchangeRecord[] = records.map((r) => {
    const sections: InterchangeRecord["sections"] = {};
    for (const t of RECORD_TABLES) {
      const rows = r.bag.get(t.shape.name);
      if (!rows?.size || t.spec.mode !== "record") continue;
      (sections[t.spec.section] ??= {})[t.shape.name] = sorted(t, rows.values());
    }
    return { domain: r.domain, id: r.id, title: r.title, sections };
  });
  const sharedOut: Record<string, Row[]> = {};
  for (const t of TABLES.values()) {
    const rows = shared.get(t.shape.name);
    if (rows?.size && t.spec.mode !== "record") sharedOut[t.shape.name] = sorted(t, rows.values());
  }
  return {
    format: INTERCHANGE_FORMAT,
    version: INTERCHANGE_VERSION,
    exportedAt: new Date().toISOString(),
    records: out,
    shared: sharedOut,
  };
}
