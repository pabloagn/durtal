import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { readableDatabaseError, uniqueConstraint } from "@/lib/db/errors";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { CACHE_TAGS, invalidate } from "@/lib/cache";
import { differingColumns, fileRow, rowKey, type Row } from "./columns";
import { INTERCHANGE_FORMAT, INTERCHANGE_VERSION, readEnvelope, readRecord, readShared, type CheckedRecord } from "./format";
import { RECORD_TABLES, TABLES, references, table, type Table } from "./tables";
import { idList } from "./export";

/*
 * Import (SLN-375). Each record is written in one transaction, so a record
 * that fails writes nothing and the others still import. An import never
 * changes or deletes a row that is already here: it adds what is missing.
 * Running the same file again writes nothing more.
 *
 * Conflict policy, for a work that is already here and differs from the file:
 * - keep: write nothing to it; the report lists the differences
 * - add: add the rows it lacks (a bottle, a location record); rows it has
 *   stay as they are, so curated edits here always win
 * - fail: report it as an error and write nothing to it
 *
 * A dry run takes every same step, each record's transaction is rolled back
 * at its end, and the report says what a real run would do.
 */

export const CONFLICT_POLICIES = ["keep", "add", "fail"] as const;
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

export type RecordOutcome = "created" | "unchanged" | "added" | "kept" | "failed";

export interface RecordReport {
  index: number;
  id: string | null;
  domain: string | null;
  title: string | null;
  outcome: RecordOutcome;
  /** Rows written, or that a dry run would write, by table */
  written: Record<string, number>;
  /** File rows that differ from the rows here, which the import left as they are */
  differences: { table: string; key: string; columns: string[] }[];
  /** File rows a kept record lacks here, by table */
  absent: Record<string, number>;
  /** Why a failed record was not imported */
  problems: string[];
}

export interface ImportReport {
  format: typeof INTERCHANGE_FORMAT;
  version: typeof INTERCHANGE_VERSION;
  dryRun: boolean;
  policy: ConflictPolicy;
  counts: Record<RecordOutcome, number>;
  records: RecordReport[];
}

const DRY_RUN = "durtal.interchange: dry run, rolled back";
/**
 * Each publisher, alias or ISBN prefix written relinks every unconfirmed
 * edition (refresh_publisher_matches, migration 0036). The import defers that
 * in each transaction and relinks once at the end.
 */
const DEFER_RELINK = sql`select set_config('durtal.defer_publisher_refresh', 'on', true)`;
const RELINKING = ["publishing_houses", "publisher_aliases", "publisher_isbn_prefixes"];
const CHUNK = 500;

type Rows = Map<string, Map<string, Row>>;
const add = (rows: Rows, t: Table, row: Row) => {
  const bucket = rows.get(t.shape.name) ?? new Map<string, Row>();
  bucket.set(rowKey(t.shape, row), row);
  rows.set(t.shape.name, bucket);
};
const count = (rows: Rows) => Object.fromEntries([...rows].filter(([, r]) => r.size).map(([name, r]) => [name, r.size]));

// ── Vocabularies ─────────────────────────────────────────────────────────────

interface Vocabulary {
  /** File id to local id, by table; null when the item is missing here and cannot be added */
  ids: Map<string, Map<string, string | null>>;
  /** Items the file has and this Durtal lacks, to add when a record needs them */
  missing: Map<string, Map<string, Row>>;
  /** Why an item cannot be used here, by table and file id */
  reasons: Map<string, Map<string, string>>;
}

/** Each vocabulary item of the file, matched to the local item of the same natural key */
async function matchVocabulary(shared: Record<string, Row[]>): Promise<{ vocabulary: Vocabulary; local: Rows }> {
  const vocabulary: Vocabulary = { ids: new Map(), missing: new Map(), reasons: new Map() };
  const local: Rows = new Map();
  for (const t of TABLES.values()) {
    if (t.spec.mode !== "entity" || !t.spec.natural) continue;
    const name = t.shape.name;
    const pk = t.shape.primaryKey[0];
    const natural = t.spec.natural;
    const here = resultRows<{ row: Row }>(await db.execute(sql`select to_jsonb(t) as row from ${sql.identifier(name)} t`)).map((r) => r.row);
    const keyOf = (row: Row) => natural.map((c) => String(row[c] ?? "")).join("|");
    const byKey = new Map(here.map((row) => [keyOf(row), String(row[pk])]));
    const usedIds = new Set(here.map((row) => String(row[pk])));
    for (const row of here) add(local, t, row);
    const ids = new Map<string, string | null>();
    const missing = new Map<string, Row>();
    const reasons = new Map<string, string>();
    // A natural key names an item by its own columns; a family it belongs to is named on its own
    const own = natural.filter((c) => !references(t).some((r) => r.column === c));
    for (const fileRow of shared[name] ?? []) {
      const translated = translate(vocabulary, t, fileRow);
      const fileId = String(fileRow[pk]);
      if (translated.missing.length) {
        ids.set(fileId, null);
        reasons.set(fileId, translated.missing[0]);
        continue;
      }
      const found = byKey.get(keyOf(translated.row));
      if (found) ids.set(fileId, found);
      else if (!t.spec.create) {
        ids.set(fileId, null);
        reasons.set(fileId, `The ${t.spec.label} “${own.map((c) => String(fileRow[c] ?? "")).join(" ")}” does not exist here`);
      } else {
        const id = usedIds.has(fileId) ? randomUUID() : fileId;
        ids.set(fileId, id);
        missing.set(id, { ...translated.row, [pk]: id });
      }
    }
    vocabulary.ids.set(name, ids);
    vocabulary.missing.set(name, missing);
    vocabulary.reasons.set(name, reasons);
  }
  // Items that point at other items of their own vocabulary (a parent theme)
  for (const [name, rows] of vocabulary.missing)
    for (const [id, row] of rows) rows.set(id, translate(vocabulary, table(name), row).row);
  return { vocabulary, local };
}

/**
 * A row with its vocabulary ids made local. `missing` names the items that
 * are not here and cannot be added.
 */
function translate(vocabulary: Vocabulary, t: Table, row: Row) {
  const out: Row = { ...row };
  const missing: string[] = [];
  for (const ref of references(t)) {
    const target = TABLES.get(ref.table)!;
    if (target.spec.mode !== "entity" || !target.spec.natural) continue;
    const value = row[ref.column];
    if (value === null || value === undefined) continue;
    const ids = vocabulary.ids.get(ref.table);
    if (!ids?.has(String(value))) continue; // Not in the file: it must be here already
    const local = ids.get(String(value));
    if (local) out[ref.column] = local;
    else missing.push(vocabulary.reasons.get(ref.table)?.get(String(value)) ?? `A ${target.spec.label} does not exist here`);
  }
  return { row: out, missing };
}

// ── What is here ─────────────────────────────────────────────────────────────

/** The rows here with the keys of these rows, by table */
async function loadLocal(local: Rows, wanted: Rows) {
  for (const [name, rows] of wanted) {
    const t = table(name);
    if (t.spec.mode === "entity" && t.spec.natural) continue; // Loaded whole
    const keys = [...rows.values()].map((row) => Object.fromEntries(t.shape.primaryKey.map((c) => [c, row[c]])));
    const using = sql.join(t.shape.primaryKey.map((c) => sql.identifier(c)), sql`, `);
    for (let i = 0; i < keys.length; i += CHUNK) {
      const found = resultRows<{ row: Row }>(
        await db.execute(
          sql`select to_jsonb(t) as row from ${sql.identifier(name)} t join jsonb_populate_recordset(null::${sql.identifier(name)}, ${JSON.stringify(keys.slice(i, i + CHUNK))}::jsonb) k using (${using})`,
        ),
      );
      for (const { row } of found) add(local, t, row);
    }
  }
}

const has = (rows: Rows, name: string, key: string) => rows.get(name)?.has(key) ?? false;

// ── Writing ──────────────────────────────────────────────────────────────────

/** Rows that point at other rows of their own table come after those rows */
function parentsFirst(t: Table, rows: Row[]): Row[] {
  const self = references(t).filter((r) => r.table === t.shape.name);
  if (!self.length) return rows;
  const pending = new Map(rows.map((row) => [rowKey(t.shape, row), row]));
  const out: Row[] = [];
  while (pending.size) {
    const ready = [...pending].filter(([, row]) => self.every((r) => !pending.has(String(row[r.column]))));
    const next = ready.length ? ready : [...pending].slice(0, 1); // A loop: the database decides
    for (const [key, row] of next) {
      out.push(row);
      pending.delete(key);
    }
  }
  return out;
}

/**
 * Rows were checked absent before the plan, so the only row with the same key
 * at this point is one the database itself just added (a person's book
 * domain when the person is added): it is kept. Any other duplicate value
 * still fails the record.
 */
function insertSql(t: Table, rows: Row[]): SQL {
  const name = sql.identifier(t.shape.name);
  const columns = sql.join(t.shape.columns.map((c) => sql.identifier(c.name)), sql`, `);
  const key = sql.join(t.shape.primaryKey.map((c) => sql.identifier(c)), sql`, `);
  return sql`insert into ${name} (${columns}) select ${columns} from jsonb_populate_recordset(null::${name}, ${JSON.stringify(rows)}::jsonb) on conflict (${key}) do nothing`;
}

function statements(plan: Rows): SQL[] {
  const out: SQL[] = [];
  for (const t of [...TABLES.values()].sort((a, b) => a.order - b.order)) {
    const name = t.shape.name;
    if (t.spec.mode === "part" && t.spec.exact) {
      const { column, table: parent } = t.spec.parent;
      const added = [...(plan.get(parent)?.keys() ?? [])];
      if (added.length)
        out.push(sql`delete from ${sql.identifier(name)} where ${sql.identifier(column)} in ${idList(added)}`);
    }
    if (!plan.get(name)?.size) continue;
    const rows = parentsFirst(t, [...plan.get(name)!.values()].map((row) => fileRow(t.shape, row)));
    for (let i = 0; i < rows.length; i += CHUNK) out.push(insertSql(t, rows.slice(i, i + CHUNK)));
  }
  return out;
}

const merge = (plans: Rows[]) => {
  const out: Rows = new Map();
  for (const plan of plans) for (const [name, rows] of plan) for (const row of rows.values()) add(out, table(name), row);
  return out;
};

function isDryRunEnd(error: unknown) {
  for (let current = error as { message?: unknown; cause?: unknown } | undefined, depth = 0; current && depth < 6; depth++) {
    if (typeof current.message === "string" && current.message.includes(DRY_RUN)) return true;
    current = current.cause as typeof current;
  }
  return false;
}

/** Writes one plan in one transaction; a dry run rolls it back. Null, or why it failed */
async function write(plan: Rows, dryRun: boolean): Promise<string | null> {
  const queries = statements(plan);
  if (!queries.length) return null;
  try {
    await atomic((d) => [
      d.execute(DEFER_RELINK),
      ...queries.map((q) => d.execute(q)),
      ...(dryRun ? [d.execute(assertSql(sql`false`, DRY_RUN))] : []),
    ]);
    return null;
  } catch (error) {
    if (dryRun && isDryRunEnd(error)) return null;
    const constraint = uniqueConstraint(error);
    const readable = readableDatabaseError(error, {
      unique: `Another record here already has one of these values (${constraint ?? "a unique value"})`,
      reference: "A row points at a record that is neither here nor in the file",
    });
    return readable instanceof Error ? readable.message : "The record could not be written";
  }
}

// ── The import ───────────────────────────────────────────────────────────────

interface Entry {
  checked: Extract<CheckedRecord, { ok: true }>;
  rows: Rows;
  report: RecordReport;
  plan: Rows;
  depends: Set<string>;
}

/** Strongly connected groups of records, those a group points at first (Tarjan) */
function groups(entries: Map<string, Entry>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  let next = 0;
  const visit = (id: string) => {
    index.set(id, next);
    low.set(id, next++);
    stack.push(id);
    onStack.add(id);
    for (const dep of entries.get(id)!.depends) {
      if (!index.has(dep)) {
        visit(dep);
        low.set(id, Math.min(low.get(id)!, low.get(dep)!));
      } else if (onStack.has(dep)) low.set(id, Math.min(low.get(id)!, index.get(dep)!));
    }
    if (low.get(id) === index.get(id)) {
      const group: string[] = [];
      for (let member = stack.pop()!; ; member = stack.pop()!) {
        onStack.delete(member);
        group.push(member);
        if (member === id) break;
      }
      out.push(group);
    }
  };
  for (const id of entries.keys()) if (!index.has(id)) visit(id);
  return out;
}

export async function importInterchange(
  input: unknown,
  options: { policy: ConflictPolicy; dryRun: boolean },
): Promise<ImportReport> {
  const { policy, dryRun } = options;
  const envelope = readEnvelope(input);
  const shared = readShared(envelope.shared);
  const reports: RecordReport[] = [];
  const failed = (c: { index: number; id: string | null; domain: string | null; title: string | null }, problems: string[]): RecordReport => ({
    ...c,
    outcome: "failed",
    written: {},
    differences: [],
    absent: {},
    problems,
  });

  const { vocabulary, local } = await matchVocabulary(shared);

  // Shared rows by table and key, with vocabulary ids made local
  const sharedRows: Rows = new Map();
  const sharedProblems = new Map<string, string[]>();
  for (const [name, rows] of Object.entries(shared)) {
    const t = table(name);
    if (t.spec.mode === "entity" && t.spec.natural) continue;
    for (const row of rows) {
      const { row: out, missing } = translate(vocabulary, t, row);
      add(sharedRows, t, out);
      if (missing.length) sharedProblems.set(`${name}|${rowKey(t.shape, out)}`, missing);
    }
  }

  // Records, checked one by one; a work twice in the file fails the second time
  const entries = new Map<string, Entry>();
  for (const [i, raw] of envelope.records.entries()) {
    const checked = readRecord(raw, i);
    if (!checked.ok) {
      reports.push(failed(checked, checked.problems));
      continue;
    }
    const { record } = checked;
    const report: RecordReport = { index: i, id: record.id, domain: record.domain, title: record.title, outcome: "unchanged", written: {}, differences: [], absent: {}, problems: [] };
    if (entries.has(record.id)) {
      reports.push(failed(report, ["This work appears twice in the file"]));
      continue;
    }
    const rows: Rows = new Map();
    for (const [name, list] of checked.rows) {
      const t = table(name);
      for (const row of list) {
        const { row: out, missing } = translate(vocabulary, t, row);
        report.problems.push(...missing);
        add(rows, t, out);
      }
    }
    reports.push(report);
    entries.set(record.id, { checked, rows, report, plan: new Map(), depends: new Set() });
  }

  await loadLocal(local, merge([...entries.values()].map((e) => e.rows)));
  await loadLocal(local, sharedRows);

  // Which record owns each row, for links between records of the file
  const owner = new Map<string, string>();
  for (const [id, entry] of entries)
    for (const [name, rows] of entry.rows) {
      const t = table(name);
      if (t.spec.mode === "record" && t.spec.referenced) continue; // Each record carries its own copy
      for (const key of rows.keys()) owner.set(`${name}|${key}`, id);
    }

  // What each record would write
  for (const [id, entry] of entries) {
    const { report } = entry;
    if (report.problems.length) continue;
    const here = local.get("works")?.get(id);
    const plan: Rows = new Map();
    if (here && here.kind !== entry.checked.record.domain) {
      report.problems.push(`This id belongs to a ${String(here.kind)} here`);
      continue;
    }
    for (const [name, rows] of entry.rows) {
      const t = table(name);
      for (const [key, row] of rows) {
        const existing = local.get(name)?.get(key);
        if (!existing) {
          add(plan, t, row);
          continue;
        }
        const columns = differingColumns(t.shape, row, existing);
        if (!columns.length) continue;
        // A new work whose own rows are already here belongs to a muddle, not to an import
        if (!here && !(t.spec.mode === "record" && t.spec.referenced))
          report.problems.push(`A ${name} row with this id already belongs to another record here`);
        report.differences.push({ table: name, key, columns });
      }
    }
    if (report.problems.length) continue;
    if (here) {
      if (!plan.size && !report.differences.length) {
        report.outcome = "unchanged";
        continue;
      }
      if (policy === "fail") {
        report.problems.push("It differs from the record here");
        continue;
      }
      if (policy === "keep") {
        report.outcome = "kept";
        report.absent = count(plan);
        continue;
      }
      if (!plan.size) {
        report.outcome = "kept";
        continue;
      }
      report.outcome = "added";
    } else report.outcome = "created";
    entry.plan = plan;

    // Links to rows of other records of the file that are not here yet
    for (const [name, rows] of plan)
      for (const ref of references(table(name))) {
        const target = TABLES.get(ref.table)!;
        if (target.spec.mode !== "record") continue;
        for (const row of rows.values()) {
          const value = row[ref.column];
          if (value === null || value === undefined || has(local, ref.table, String(value))) continue;
          const other = owner.get(`${ref.table}|${value}`);
          if (other && other !== id) entry.depends.add(other);
        }
      }
  }

  // Shared rows each plan needs: missing ones from the file, with their parts
  const needShared = (plan: Rows): string[] => {
    const problems: string[] = [];
    const queue: [string, Row][] = [...plan].flatMap(([name, rows]) => [...rows.values()].map((row) => [name, row] as [string, Row]));
    const partsFor = (t: Table, id: string, existing: boolean) => {
      for (const part of TABLES.values()) {
        if (part.spec.mode !== "part" || part.spec.parent.table !== t.shape.name || (existing && !part.spec.forExisting)) continue;
        const column = part.spec.parent.column;
        for (const [key, row] of sharedRows.get(part.shape.name) ?? [])
          if (String(row[column]) === id && !has(local, part.shape.name, key) && !has(plan, part.shape.name, key)) {
            add(plan, part, row);
            queue.push([part.shape.name, row]);
          }
      }
      // A person, organization or venue the import adds brings its identifiers and sources;
      // one already here keeps what it has
      if (existing) return;
      for (const owned of TABLES.values()) {
        if (owned.spec.mode !== "record") continue;
        for (const by of owned.spec.entityOwners ?? []) {
          if (by.table !== t.shape.name) continue;
          for (const [key, row] of sharedRows.get(owned.shape.name) ?? [])
            if (String(row[by.column]) === id && !has(local, owned.shape.name, key) && !has(plan, owned.shape.name, key)) {
              add(plan, owned, row);
              queue.push([owned.shape.name, row]);
            }
        }
      }
    };
    while (queue.length) {
      const [name, row] = queue.shift()!;
      const problemsHere = sharedProblems.get(`${name}|${rowKey(table(name).shape, row)}`);
      if (problemsHere) problems.push(...problemsHere);
      for (const ref of references(table(name))) {
        const target = TABLES.get(ref.table)!;
        const value = row[ref.column];
        if (target.spec.mode !== "entity" || value === null || value === undefined) continue;
        const key = String(value);
        if (has(plan, ref.table, key)) continue;
        if (target.spec.natural) {
          const create = vocabulary.missing.get(ref.table)?.get(key);
          if (create && !has(local, ref.table, key)) {
            add(plan, target, create);
            queue.push([ref.table, create]);
          }
          continue;
        }
        if (has(local, ref.table, key)) {
          partsFor(target, key, true);
          continue;
        }
        const fromFile = sharedRows.get(ref.table)?.get(key);
        if (!fromFile) {
          problems.push(`It points at a ${target.spec.label} that is neither here nor in the file (${key})`);
          continue;
        }
        add(plan, target, fromFile);
        queue.push([ref.table, fromFile]);
        partsFor(target, key, false);
      }
    }
    return [...new Set(problems)];
  };

  const wrote = new Set<string>();
  let relink = false;
  for (const group of groups(entries)) {
    const members = group.map((id) => entries.get(id)!);
    const writing = members.filter((m) => !m.report.problems.length && (m.report.outcome === "created" || m.report.outcome === "added"));
    if (!writing.length) continue;
    // A record that points at another record of the file that failed fails too
    const blocked = [...new Set(writing.flatMap((m) => [...m.depends]))]
      .filter((dep) => !group.includes(dep) && !wrote.has(dep))
      .map((dep) => entries.get(dep)!.report.title ?? dep);
    const problems = blocked.length ? [`It points at ${blocked.map((t) => `“${t}”`).join(", ")}, which this import did not write`] : [];
    if (!problems.length) for (const m of writing) problems.push(...needShared(m.plan));
    if (!problems.length) {
      // A dry run wrote nothing before: the records this group points at go first in its transaction
      const before: Rows[] = [];
      if (dryRun) {
        const seen = new Set<string>(group);
        const walk = (id: string) => {
          for (const dep of entries.get(id)!.depends)
            if (!seen.has(dep)) {
              seen.add(dep);
              before.push(entries.get(dep)!.plan);
              walk(dep);
            }
        };
        group.forEach(walk);
      }
      // Rows an earlier record of this run wrote (a shared person, a cited source) are here now
      for (const m of writing)
        for (const [name, rows] of m.plan) for (const key of [...rows.keys()]) if (has(local, name, key)) rows.delete(key);
      const plan = merge([...before, ...writing.map((m) => m.plan)]);
      const error = await write(plan, dryRun);
      if (error) problems.push(error);
      else {
        for (const m of writing) {
          wrote.add(m.report.id!);
          m.report.written = count(m.plan);
        }
        if (!dryRun) for (const [name, rows] of plan) for (const row of rows.values()) add(local, table(name), row);
        if (!dryRun && RELINKING.some((name) => plan.get(name)?.size)) relink = true;
      }
    }
    if (problems.length) for (const m of writing) m.report.problems.push(...problems);
  }

  for (const report of reports)
    if (report.problems.length) {
      report.outcome = "failed";
      report.written = {};
    }
  // The relinking each publisher write deferred, once for the whole import
  if (relink) await db.execute(sql`select refresh_all_publisher_links()`);
  if (!dryRun && wrote.size)
    invalidate(...Object.values(CACHE_TAGS).filter((tag) => tag !== CACHE_TAGS.settings));

  const counts: Record<RecordOutcome, number> = { created: 0, unchanged: 0, added: 0, kept: 0, failed: 0 };
  for (const report of reports) counts[report.outcome]++;
  return { format: INTERCHANGE_FORMAT, version: INTERCHANGE_VERSION, dryRun, policy, counts, records: reports.sort((a, b) => a.index - b.index) };
}

/** The record tables, for callers that list what a file carries */
export const INTERCHANGE_RECORD_TABLES = RECORD_TABLES.map((t) => t.shape.name);
