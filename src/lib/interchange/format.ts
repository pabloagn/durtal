import { WORK_KINDS, isWorkKind, type WorkKind } from "@/lib/catalogue/kinds";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import { rowProblems, type Row } from "./columns";
import { SECTIONS, TABLES, carries, entityOwner, references, type Section } from "./tables";

/*
 * The Durtal interchange file (SLN-375): one JSON document that carries
 * records of every collection with what makes them whole. A record is one
 * work and its rows, grouped in sections; `shared` carries the people,
 * organizations, venues, places, collections and vocabularies the records
 * point at. Rows are the stored rows, keyed by column name, so an export
 * imports back unchanged.
 */

export const INTERCHANGE_FORMAT = "durtal.interchange";
export const INTERCHANGE_VERSION = 1;

export interface InterchangeRecord {
  domain: WorkKind;
  id: string;
  title: string;
  sections: Partial<Record<Section, Record<string, Row[]>>>;
}

export interface InterchangeDocument {
  format: typeof INTERCHANGE_FORMAT;
  version: typeof INTERCHANGE_VERSION;
  exportedAt: string;
  records: InterchangeRecord[];
  shared: Record<string, Row[]>;
}

/** A file this Durtal cannot read at all; `issues` name each place */
export class InterchangeFileError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "InterchangeFileError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The envelope: format, version, records and shared rows. Fails for anything it does not know */
export function readEnvelope(input: unknown): { records: unknown[]; shared: Record<string, unknown> } {
  if (!isObject(input) || input.format !== INTERCHANGE_FORMAT)
    throw new InterchangeFileError("This is not a Durtal interchange file");
  if (input.version !== INTERCHANGE_VERSION)
    throw new InterchangeFileError(
      typeof input.version === "number" && Number.isInteger(input.version)
        ? `This file is interchange version ${input.version}; this Durtal reads version ${INTERCHANGE_VERSION}`
        : "The file does not say which interchange version it is",
    );
  if (!Array.isArray(input.records)) throw new InterchangeFileError("The file has no list of records");
  if (!isObject(input.shared)) throw new InterchangeFileError("The file has no shared section");
  return { records: input.records, shared: input.shared };
}

/** The shared rows, checked table by table; any problem refuses the whole file */
export function readShared(shared: Record<string, unknown>): Record<string, Row[]> {
  const issues: string[] = [];
  const out: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(shared)) {
    const t = TABLES.get(name);
    // Identifiers and sources travel here too, when a person, an organization or a venue owns them
    if (!t || (t.spec.mode === "record" && !t.spec.entityOwners)) {
      issues.push(`shared.${name}: is not a shared table of version ${INTERCHANGE_VERSION}`);
      continue;
    }
    if (!Array.isArray(rows)) {
      issues.push(`shared.${name}: must be a list of rows`);
      continue;
    }
    rows.forEach((row, i) => {
      const problems = rowProblems(t.shape, row);
      for (const problem of problems) issues.push(`shared.${name}[${i}].${problem}`);
      if (!problems.length && t.spec.mode === "record" && !entityOwner(t, row as Row))
        issues.push(`shared.${name}[${i}]: must belong to one person, organization or venue`);
    });
    out[name] = rows as Row[];
  }
  if (issues.length) throw new InterchangeFileError("The shared section has rows this Durtal cannot read", issues);
  return out;
}

/**
 * Every row of a record belongs to it: its owner column names the record's
 * work or another row of the record. A record never writes into another one.
 * Dates and sources a row cites may belong elsewhere.
 */
function ownershipProblems(rows: Map<string, Row[]>): string[] {
  const problems: string[] = [];
  const keys = (name: string) => {
    const t = TABLES.get(name)!;
    return new Set((rows.get(name) ?? []).map((row) => String(row[t.shape.primaryKey[0]])));
  };
  // The rows each table's rows are cited by, from every other row of the record
  const cited = new Map<string, Set<string>>();
  for (const [name, list] of rows)
    for (const ref of references(TABLES.get(name)!))
      for (const row of list) {
        if (row[ref.column] === null || row[ref.column] === undefined) continue;
        const set = cited.get(ref.table) ?? new Set<string>();
        set.add(String(row[ref.column]));
        cited.set(ref.table, set);
      }
  for (const [name, list] of rows) {
    const t = TABLES.get(name)!;
    if (t.spec.mode !== "record" || !t.spec.parent) continue;
    const { parent, alsoParent, referenced, section } = t.spec;
    const owners = keys(parent.table);
    const others = alsoParent ? keys(alsoParent.table) : new Set<string>();
    list.forEach((row, i) => {
      const owned =
        owners.has(String(row[parent.column])) || (!!alsoParent && others.has(String(row[alsoParent.column])));
      const citedHere = referenced && cited.get(name)?.has(String(row[t.shape.primaryKey[0]]));
      if (!owned && !citedHere) problems.push(`${section}.${name}[${i}]: belongs to another record`);
    });
  }
  return problems.map((p) => `sections.${p}`);
}

export type CheckedRecord =
  | { ok: true; index: number; record: InterchangeRecord; rows: Map<string, Row[]> }
  | { ok: false; index: number; id: string | null; domain: string | null; title: string | null; problems: string[] };

/**
 * One record, checked on its own: a record this Durtal cannot read fails
 * alone, with every problem named, and the others still import.
 */
export function readRecord(input: unknown, index: number): CheckedRecord {
  const fail = (problems: string[]): CheckedRecord => ({
    ok: false,
    index,
    id: isObject(input) && typeof input.id === "string" ? input.id : null,
    domain: isObject(input) && typeof input.domain === "string" ? input.domain : null,
    title: isObject(input) && typeof input.title === "string" ? input.title : null,
    problems,
  });
  if (!isObject(input)) return fail(["must be an object"]);
  const { domain, id, title, sections } = input;
  if (!isWorkKind(domain))
    return fail([`domain: “${String(domain)}” is not a collection this Durtal knows (${WORK_KINDS.join(", ")})`]);
  if (!WORK_DOMAINS[domain].enabled) return fail([`domain: the ${WORK_DOMAINS[domain].pluralLabel} collection is not open here`]);
  if (typeof id !== "string" || typeof title !== "string" || !isObject(sections))
    return fail(["must have an id, a title and sections"]);
  const problems: string[] = [];
  const rows = new Map<string, Row[]>();
  for (const [section, tables] of Object.entries(sections)) {
    if (!SECTIONS.includes(section as Section) || !isObject(tables)) {
      problems.push(`sections.${section}: is not a section of version ${INTERCHANGE_VERSION}`);
      continue;
    }
    for (const [name, list] of Object.entries(tables)) {
      const t = TABLES.get(name);
      const path = `sections.${section}.${name}`;
      if (!t || t.spec.mode !== "record" || t.spec.section !== section) {
        problems.push(`${path}: is not part of this section`);
        continue;
      }
      if (!carries(t, domain)) {
        problems.push(`${path}: a ${domain} record cannot carry it`);
        continue;
      }
      if (!Array.isArray(list)) {
        problems.push(`${path}: must be a list of rows`);
        continue;
      }
      list.forEach((row, i) => {
        for (const problem of rowProblems(t.shape, row)) problems.push(`${path}[${i}].${problem}`);
      });
      rows.set(name, list as Row[]);
    }
  }
  const root = rows.get("works") ?? [];
  if (root.length !== 1 || root[0].id !== id) problems.push("sections.identity.works: must hold exactly the record's own work");
  else if (root[0].kind !== domain) problems.push(`sections.identity.works[0].kind: must be ${domain}`);
  if (!problems.length) problems.push(...ownershipProblems(rows));
  if (problems.length) return fail(problems);
  return { ok: true, index, record: { domain, id, title, sections: sections as InterchangeRecord["sections"] }, rows };
}
