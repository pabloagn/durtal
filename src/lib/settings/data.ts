import { count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  authors,
  collections,
  editions,
  enrichmentCosts,
  instances,
  locations,
  publishingHouses,
  recommenders,
  series,
  venues,
  works,
} from "@/lib/db/schema";
import { bookCondition } from "@/lib/catalogue/book-boundary";
import { PLACEHOLDER_SOURCE } from "@/lib/match/identify";
import { getSeriesSuggestions } from "@/lib/actions/series";
import { resultRows } from "@/lib/harmonization/store";
import { monthWindow, monthlyCapUsd } from "@/lib/enrichment/meter";

/** The catalogue in numbers and the review queues (Settings, Data). Server only. */

export interface CatalogueCount {
  label: string;
  value: number;
}

/** How many records of each kind: books, their editions and copies, people, and the rest. */
export async function catalogueCounts(): Promise<CatalogueCount[]> {
  const total = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  const counts = await Promise.all([
    total(db.select({ n: count() }).from(works).where(bookCondition)),
    total(db.select({ n: count() }).from(editions)),
    total(db.select({ n: count() }).from(instances)),
    // Every person, in every collection (SLN-419)
    total(db.select({ n: count() }).from(authors)),
    total(db.select({ n: count() }).from(publishingHouses)),
    total(db.select({ n: count() }).from(series)),
    total(db.select({ n: count() }).from(collections)),
    total(db.select({ n: count() }).from(recommenders)),
    total(db.select({ n: count() }).from(venues)),
    total(db.select({ n: count() }).from(locations)),
  ]);
  const labels = [
    "Books",
    "Editions",
    "Copies",
    "People",
    "Publishers",
    "Series",
    "Collections",
    "Recommenders",
    "Places",
    "Locations",
  ];
  return labels.map((label, i) => ({ label, value: counts[i] }));
}

/** The cheap queue counts: editions that hold a placeholder, and series suggestions. */
export async function reviewQueueCounts() {
  const [[placeholders], suggestions] = await Promise.all([
    db.select({ n: count() }).from(editions).where(eq(editions.metadataSource, PLACEHOLDER_SOURCE)),
    getSeriesSuggestions(),
  ]);
  return {
    identify: placeholders?.n ?? 0,
    suggestedBooks: suggestions.length,
    suggestedSeries: new Set(suggestions.map((s) => s.seriesId)).size,
  };
}

// ── Book enrichment (SLN-468) ──────────────────────────────────────────────

/**
 * This month's metered spend: settled cost and open reservations at their
 * estimate (both count against the cap), the cap, and the last paid call.
 */
export async function enrichmentSpend(now = new Date()) {
  const { start, end } = monthWindow(now);
  const inMonth = sql`${enrichmentCosts.createdAt} >= ${start.toISOString()} and ${enrichmentCosts.createdAt} < ${end.toISOString()}`;
  const [row] = await db
    .select({
      settled: sql<number>`coalesce(sum(${enrichmentCosts.costUsd}) filter (where ${enrichmentCosts.status} = 'settled' and ${inMonth}), 0)::float8`,
      reserved: sql<number>`coalesce(sum(${enrichmentCosts.estimatedCostUsd}) filter (where ${enrichmentCosts.status} = 'reserved' and ${inMonth}), 0)::float8`,
      openReservations: sql<number>`(count(*) filter (where ${enrichmentCosts.status} = 'reserved'))::int`,
      lastPaidAt: sql<string | null>`max(${enrichmentCosts.createdAt}) filter (where coalesce(${enrichmentCosts.costUsd}, ${enrichmentCosts.estimatedCostUsd}) > 0)`,
    })
    .from(enrichmentCosts);
  return {
    spent: row?.settled ?? 0,
    reserved: row?.reserved ?? 0,
    openReservations: row?.openReservations ?? 0,
    lastPaidAt: row?.lastPaidAt ? new Date(row.lastPaidAt) : null,
    cap: monthlyCapUsd(),
  };
}

/** The evidence cache: documents stored, and the bytes of their objects, each object counted once */
export async function evidenceCacheStats() {
  const [row] = resultRows<{ documents: number; bytes: number; last_fetch: string | null }>(
    await db.execute(sql`
      with evidence as (select * from source_records where payload ->> 'kind' in ('evidence_page', 'evidence_text')),
      objects as (
        select payload ->> 'rawKey' as key, (payload ->> 'rawStoredBytes')::bigint as bytes from evidence where payload ? 'rawKey'
        union
        select payload ->> 'textKey', (payload ->> 'textBytes')::bigint from evidence where payload ? 'textKey'
      )
      select (select count(*) from evidence)::int as documents,
        (select coalesce(sum(bytes), 0) from objects)::float8 as bytes,
        (select max(retrieved_at) from evidence where payload ->> 'kind' = 'evidence_page') as last_fetch`),
  );
  return { documents: row?.documents ?? 0, bytes: row?.bytes ?? 0, lastFetch: row?.last_fetch ? new Date(row.last_fetch) : null };
}
