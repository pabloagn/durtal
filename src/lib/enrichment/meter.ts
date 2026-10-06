import { and, eq, sql } from "drizzle-orm";
import { db as appDb } from "@/lib/db";
import { atomicOn } from "@/lib/db/atomic";
import type { Db } from "@/lib/catalogue/work-store";
import { requireBookWork } from "@/lib/catalogue/book-boundary";
import { enrichmentCosts, enrichmentJobs } from "@/lib/db/schema";
import { appTimeZone } from "@/lib/utils/date";
import { costOf, priceFor, priceVersion, PRICES, type PriceRow } from "./prices";

/**
 * The cost meter (SLN-468). Every paid or free-tier provider call goes
 * through `metered`: a reservation in its own short transaction, committed
 * before the call, that passes only within the monthly cap (and the run's
 * limit); then the call; then a settlement with the provider's own counts.
 * The ledger, `enrichment_costs`, is never deleted.
 */

/** A run stops on it like on a quota refusal: the job in hand writes nothing and is held (`budget`) */
export class BudgetStop extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetStop";
  }
}

const MONTHLY = "Stopped: monthly budget reached";
const RUN = "Stopped: run limit reached";

/** The monthly cap in US dollars, or null when ENRICHMENT_MONTHLY_CAP_USD is not set */
export function monthlyCapUsd(): number | null {
  const value = process.env.ENRICHMENT_MONTHLY_CAP_USD?.trim();
  if (!value) return null;
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("ENRICHMENT_MONTHLY_CAP_USD must be an amount in US dollars");
  return Number(value);
}

/** How far a time zone's wall clock is ahead of UTC at an instant, in ms */
function zoneOffset(at: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(at / 1000) * 1000;
}

/** The instant a month starts in a time zone */
function monthStart(year: number, month: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, 1);
  // Twice: the offset at the guess may differ from the offset at the start (a DST change)
  let start = wall - zoneOffset(wall, timeZone);
  start = wall - zoneOffset(start, timeZone);
  return new Date(start);
}

/** The calendar month of `now` in the time zone: [start, end) */
export function monthWindow(now: Date, timeZone: string = appTimeZone()): { start: Date; end: Date } {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric" })
    .formatToParts(now)
    .filter((p) => p.type === "year" || p.type === "month")
    .map((p) => Number(p.value));
  return { start: monthStart(year, month, timeZone), end: month === 12 ? monthStart(year + 1, 1, timeZone) : monthStart(year, month + 1, timeZone) };
}

/** Spend that counts against a limit: settled cost, and open reservations at their estimate */
const counted = sql`coalesce(sum(coalesce(${enrichmentCosts.costUsd}, ${enrichmentCosts.estimatedCostUsd})) filter (where ${enrichmentCosts.status} <> 'released'), 0)`;

export interface MeterInput {
  /** The script's own connection; the app's by default */
  database?: Db;
  provider: string;
  operation: string;
  /** The units the call is expected to use */
  estimate: Record<string, number>;
  workId?: string | null;
  jobId?: string | null;
  runId?: string | null;
  /** A limit for this run, in US dollars: it only lowers the monthly cap */
  runLimitUsd?: number;
  /** Tests only */
  prices?: readonly PriceRow[];
  capUsd?: number | null;
  now?: Date;
}

/** What a call returns: its result and the units the provider billed */
export interface MeteredAnswer<T> {
  result: T;
  units: Record<string, number>;
}

/**
 * Meter one call. No cap, no price row, or a reservation past the cap or the
 * run limit: BudgetStop (or an error), and the call is never made. A failed
 * call settles at its estimate unless the error says it was not billed
 * (`billed: false` on the error), which releases the reservation.
 */
export async function metered<T>(input: MeterInput, call: () => Promise<MeteredAnswer<T>>): Promise<T> {
  const database = input.database ?? appDb;
  // A cost row's book is checked before anything else
  if (input.workId) await requireBookWork(input.workId, database);
  const cap = input.capUsd !== undefined ? input.capUsd : monthlyCapUsd();
  if (cap === null) throw new BudgetStop(`${MONTHLY}: ENRICHMENT_MONTHLY_CAP_USD is not set`);
  const price = priceFor(input.provider, input.operation, input.prices ?? PRICES);
  const estimatedCost = costOf(input.estimate, price);
  const { start, end } = monthWindow(input.now ?? new Date());
  const id = crypto.randomUUID();

  try {
    await atomicOn(database, (d) => [
        d.execute(sql`select pg_advisory_xact_lock(hashtextextended('durtal-enrichment-costs', 0))`),
        d.execute(
          sql`select harmonization_assert((select ${counted} from ${enrichmentCosts} where ${enrichmentCosts.createdAt} >= ${start.toISOString()} and ${enrichmentCosts.createdAt} < ${end.toISOString()}) + ${estimatedCost} <= ${cap}, ${MONTHLY})`,
        ),
        ...(input.runLimitUsd !== undefined && input.runId
          ? [
              d.execute(
                sql`select harmonization_assert((select ${counted} from ${enrichmentCosts} where ${enrichmentCosts.runId} = ${input.runId}) + ${estimatedCost} <= ${input.runLimitUsd}, ${RUN})`,
              ),
            ]
          : []),
        d.insert(enrichmentCosts).values({
          id,
          provider: input.provider,
          operation: input.operation,
          estimatedUnits: input.estimate,
          estimatedCostUsd: estimatedCost,
          priceVersion: priceVersion(price),
          workId: input.workId ?? null,
          jobId: input.jobId ?? null,
          runId: input.runId ?? null,
        }),
    ]);
  } catch (error) {
    const text = `${(error as Error).message} ${((error as { cause?: Error }).cause?.message ?? "")}`;
    if (text.includes(RUN)) throw new BudgetStop(RUN);
    if (text.includes(MONTHLY)) throw new BudgetStop(MONTHLY);
    throw error;
  }

  let answer: MeteredAnswer<T>;
  try {
    answer = await call();
  } catch (error) {
    if ((error as { billed?: boolean }).billed === false) await release(id, database);
    else await settle(id, input.jobId ?? null, input.estimate, estimatedCost, database);
    throw error;
  }
  await settle(id, input.jobId ?? null, answer.units, costOf(answer.units, price), database);
  return answer.result;
}

/** Settle a reservation with the units billed, and add the cost to its job */
async function settle(id: string, jobId: string | null, units: Record<string, number>, cost: number, database: Db) {
  await atomicOn(database, (d) => [
      d
        .update(enrichmentCosts)
        .set({ status: "settled", units, costUsd: cost, settledAt: new Date() })
        .where(and(eq(enrichmentCosts.id, id), eq(enrichmentCosts.status, "reserved"))),
      ...(jobId ? [d.update(enrichmentJobs).set({ cost: sql`${enrichmentJobs.cost} + ${cost}` }).where(eq(enrichmentJobs.id, jobId))] : []),
  ]);
}

/** A call never billed: its reservation no longer counts */
async function release(id: string, database: Db) {
  await atomicOn(database, (d) => [
    d.update(enrichmentCosts).set({ status: "released", settledAt: new Date() }).where(and(eq(enrichmentCosts.id, id), eq(enrichmentCosts.status, "reserved"))),
  ]);
}
