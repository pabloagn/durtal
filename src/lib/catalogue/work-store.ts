import { randomUUID } from "node:crypto";
import { inArray, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db";
import {
  catalogueDates,
  customTaxonomyItemWorks,
  organizationRoles,
  workCredits,
} from "@/lib/db/schema";
import {
  CATALOGUE_DATE_REFERENCES,
  dateColumns,
  dateFromColumns,
  type CatalogueDate,
} from "./dates";
import type { WorkKind } from "./kinds";
import type { NON_PUBLISHING_ROLES } from "./organizations";
import { resultRows } from "@/lib/harmonization/store";
import type { creditInputSchema } from "@/lib/validations/people";

/**
 * Write helpers shared by the typed domain services (perfumes, films). All
 * builders run on the transaction connection passed to `atomic`.
 */
export type Db = typeof db;
type Query = ReturnType<Db["execute"]>;
export const STALE_RECORD =
  "This record changed while you were editing; reload before saving";

export function uuids(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`,`,
  );
}
/** The md5 fingerprint of one record's stored state, or null when it is gone. */
export async function readFingerprint(expression: SQL) {
  return (
    resultRows<{ fingerprint: string | null }>(
      await db.execute(sql`select ${expression} as fingerprint`),
    )[0]?.fingerprint ?? null
  );
}

// ── Immutable date values ────────────────────────────────────────────────────

export interface StoredDate {
  id: string;
  value: CatalogueDate;
}
export async function loadDates(ids: (string | null)[]) {
  const list = [...new Set(ids.filter((id): id is string => !!id))];
  if (!list.length) return new Map<string, CatalogueDate>();
  const rows = await db
    .select()
    .from(catalogueDates)
    .where(inArray(catalogueDates.id, list));
  return new Map(rows.map((row) => [row.id, dateFromColumns(row)]));
}
export function storedDate(
  dates: Map<string, CatalogueDate>,
  id: string | null,
): StoredDate | null {
  return id ? { id, value: dates.get(id)! } : null;
}
/**
 * A replacement for an edited date, or undefined when the field is unchanged.
 * Date values are immutable: a change creates a new value and releases the old.
 */
export function replaceDate(
  current: StoredDate | null,
  next: CatalogueDate | null | undefined,
) {
  if (next === undefined) return undefined;
  const same =
    current && next
      ? JSON.stringify(dateColumns(current.value)) ===
        JSON.stringify(dateColumns(next))
      : !current && !next;
  if (same) return undefined;
  return {
    row: next ? { id: randomUUID(), ...dateColumns(next) } : null,
    oldId: current?.id ?? null,
  };
}
export function newDate(value: CatalogueDate | null) {
  return value ? { id: randomUUID(), ...dateColumns(value) } : null;
}
export function insertDates(
  d: Db,
  rows: (ReturnType<typeof newDate> | undefined)[],
) {
  const values = rows.filter((row): row is NonNullable<typeof row> => !!row);
  return values.length ? [d.insert(catalogueDates).values(values)] : [];
}
/** Removes released values that no record references any more. */
export function releaseDates(d: Db, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((id): id is string => !!id))];
  if (!list.length) return [];
  const referenced = sql.join(
    CATALOGUE_DATE_REFERENCES.map(
      ([table, column]) =>
        sql`exists(select 1 from ${sql.identifier(table)} r where r.${sql.identifier(column)}=c.id)`,
    ),
    sql` or `,
  );
  return [
    d.execute(
      sql`delete from catalogue_dates c where c.id in (${uuids(list)}) and not (${referenced})`,
    ),
  ];
}

// ── Section writers ──────────────────────────────────────────────────────────

/** Array order becomes the display order inside each group. */
export function orderWithin<T>(list: T[], group: (value: T) => string) {
  const counts = new Map<string, number>();
  return list.map((value) => {
    const key = group(value);
    const sortOrder = counts.get(key) ?? 0;
    counts.set(key, sortOrder + 1);
    return { ...value, sortOrder };
  });
}
export function insertWorkTaxa(d: Db, workId: string, itemIds: string[]) {
  return itemIds.length
    ? [
        d
          .insert(customTaxonomyItemWorks)
          .values(itemIds.map((itemId) => ({ itemId, workId }))),
      ]
    : [];
}
/** Kept credit IDs keep their creation time. */
export function insertCredits(
  d: Db,
  workId: string,
  list: z.output<typeof creditInputSchema>[],
  existing: { id: string; createdAt: Date }[],
) {
  return list.length
    ? [
        d.insert(workCredits).values(
          list.map((credit, sortOrder) => ({
            ...credit,
            id: credit.id ?? randomUUID(),
            workId,
            sortOrder,
            createdAt: existing.find((old) => old.id === credit.id)?.createdAt,
          })),
        ),
      ]
    : [];
}
/** Supplied IDs must name rows the record already has. */
export function requireOwnIds(
  list: { id?: string }[],
  existing: { id: string }[],
  label: string,
) {
  const ids = new Set(existing.map((row) => row.id));
  if (list.some((row) => row.id && !ids.has(row.id)))
    throw new Error(`A ${label} ID belongs to another record or was removed`);
}
export function lockWork(d: Db, workId: string, kind: WorkKind): Query {
  return d.execute(
    sql`select id from works where id=${workId}::uuid and kind=${kind} for update`,
  );
}

/** A field sent as undefined means "not supplied", never "clear it". */
export function supplied<T extends object>(patch: T) {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * Naming an organization in a role (a perfume house, a production company, a
 * retailer) gives it that role, in the same write: the database requires the
 * role, and the user chose it. A role it already has stays as it is; no other
 * role is added.
 */
export function organizationRoleQueries(
  d: Db,
  list: { organizationId: string; role: (typeof NON_PUBLISHING_ROLES)[number] }[],
) {
  const unique = [
    ...new Map(list.map((o) => [`${o.organizationId}:${o.role}`, o])).values(),
  ];
  return unique.length
    ? [
        d
          .insert(organizationRoles)
          .values(
            unique.map(({ organizationId, role }) => ({ organizationId, role })),
          )
          .onConflictDoNothing(),
      ]
    : [];
}
