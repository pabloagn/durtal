import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  authors,
  collections,
  editions,
  instances,
  locations,
  publishingHouses,
  recommenders,
  series,
  venues,
  works,
} from "@/lib/db/schema";
import { bookCondition } from "@/lib/catalogue/book-boundary";
import { bookPersonCondition } from "@/lib/catalogue/person-boundary";
import { PLACEHOLDER_SOURCE } from "@/lib/match/identify";
import { getSeriesSuggestions } from "@/lib/actions/series";

/** The catalogue in numbers and the review queues (Settings, Data). Server only. */

export interface CatalogueCount {
  label: string;
  value: number;
}

/** How many records of each kind: books and their authors, as the dashboard counts them. */
export async function catalogueCounts(): Promise<CatalogueCount[]> {
  const total = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  const counts = await Promise.all([
    total(db.select({ n: count() }).from(works).where(bookCondition)),
    total(db.select({ n: count() }).from(editions)),
    total(db.select({ n: count() }).from(instances)),
    total(db.select({ n: count() }).from(authors).where(bookPersonCondition)),
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
    "Authors",
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
