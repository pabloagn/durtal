import type { ReadingDatePrecision, ReadingStatus } from "./constants";

/*
 * The one duplicate rule for readings (SLN-444): the import preview, the
 * seed step, the reader backfill, writeReadings and the enrichment epic all
 * use it. Pure; `findDuplicateReading` in the service loads a book's
 * readings and calls it.
 */

export interface DuplicateCandidate {
  readingId?: string | null;
  sourceKey?: string | null;
  status: ReadingStatus;
  finishedOn?: string | null;
  finishedPrecision: ReadingDatePrecision;
}

export interface ExistingReading {
  id: string;
  sourceKey: string | null;
  status: ReadingStatus;
  finishedOn: string | null;
  finishedPrecision: ReadingDatePrecision;
}

export interface DuplicateContext {
  /** The other rows for the same book in the same file or batch, before this one */
  otherRows?: DuplicateCandidate[];
  /** Imports: an undated row is new only beyond the undated reads already there */
  countRule?: boolean;
}

export type DuplicateReason = "Same reading" | "Same source" | "Same finish date" | "Undated read";

export interface DuplicateResult {
  verdict: "new" | "already_present" | "possible_duplicate";
  match?: { readingId: string; reason: DuplicateReason };
}

const dated = (r: { finishedOn?: string | null; finishedPrecision: ReadingDatePrecision }) =>
  !!r.finishedOn && r.finishedPrecision !== "unknown";
const done = (status: ReadingStatus) => status === "finished" || status === "abandoned";

/** Two finish dates agree at the coarser of their precisions: the same day, month or year */
function sameFinish(a: { finishedOn?: string | null; finishedPrecision: ReadingDatePrecision }, b: ExistingReading) {
  if (!dated(a) || !dated(b)) return false;
  const coarse = [a.finishedPrecision, b.finishedPrecision];
  const length = coarse.includes("year") ? 4 : coarse.includes("month") ? 7 : 10;
  return a.finishedOn!.slice(0, length) === b.finishedOn!.slice(0, length);
}

/**
 * The verdict for each row of one book, in row order. Each existing reading
 * matches one row at most. In order: the same reading or source key; the same
 * read (same status, the same finish at the coarser precision); an undated
 * finished or abandoned row against that status's unmatched readings (with the
 * count rule the first rows are already present and the rest new; without
 * it, a possible duplicate). Anything else is new; an open row for a book
 * with another open reading is the writer's to refuse.
 */
export function duplicateVerdicts(
  rows: DuplicateCandidate[],
  existing: ExistingReading[],
  { countRule = false }: { countRule?: boolean } = {},
): DuplicateResult[] {
  const results: (DuplicateResult | null)[] = rows.map(() => null);
  const used = new Set<string>();
  const take = (i: number, reading: ExistingReading, reason: DuplicateReason, verdict: DuplicateResult["verdict"]) => {
    used.add(reading.id);
    results[i] = { verdict, match: { readingId: reading.id, reason } };
  };
  // 1. Exact: the same reading, or the same source
  rows.forEach((row, i) => {
    const byId = row.readingId ? existing.find((e) => e.id === row.readingId && !used.has(e.id)) : undefined;
    if (byId) return take(i, byId, "Same reading", "already_present");
    const byKey = row.sourceKey ? existing.find((e) => e.sourceKey === row.sourceKey && !used.has(e.id)) : undefined;
    if (byKey) take(i, byKey, "Same source", "already_present");
  });
  // 2. The same read: same status, the same finish date
  rows.forEach((row, i) => {
    if (results[i] || !done(row.status) || !dated(row)) return;
    const same = existing.find((e) => !used.has(e.id) && e.status === row.status && sameFinish(row, e));
    if (same) take(i, same, "Same finish date", "already_present");
  });
  // 3. Undated reads, per status
  for (const status of ["finished", "abandoned"] as const) {
    const free = existing.filter((e) => e.status === status && !used.has(e.id));
    let next = 0;
    rows.forEach((row, i) => {
      if (results[i] || row.status !== status || dated(row)) return;
      const reading = free[next];
      if (!reading) return;
      next++;
      take(i, reading, "Undated read", countRule ? "already_present" : "possible_duplicate");
    });
  }
  return results.map((r) => r ?? { verdict: "new" });
}

/** The verdict for one row, after the other rows of its book in the same file or batch */
export function duplicateVerdict(
  candidate: DuplicateCandidate,
  existing: ExistingReading[],
  context: DuplicateContext = {},
): DuplicateResult {
  const rows = [...(context.otherRows ?? []), candidate];
  return duplicateVerdicts(rows, existing, { countRule: context.countRule })[rows.length - 1];
}

/** Loads a book's readings and applies the rule to one candidate */
export async function findDuplicateReading(
  workId: string,
  candidate: DuplicateCandidate,
  context: DuplicateContext = {},
): Promise<DuplicateResult> {
  const [{ db }, { readings }, { eq }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/db/schema"),
    import("drizzle-orm"),
  ]);
  const existing = await db
    .select({
      id: readings.id,
      sourceKey: readings.sourceKey,
      status: readings.status,
      finishedOn: readings.finishedOn,
      finishedPrecision: readings.finishedPrecision,
    })
    .from(readings)
    .where(eq(readings.workId, workId));
  return duplicateVerdict(candidate, existing, context);
}
