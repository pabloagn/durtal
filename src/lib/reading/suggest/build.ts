import { queueEdition, type QueueEdition } from "../queue";
import type { SuggestBook, SuggestContext, SuggestLoad } from "./types";

/*
 * What the engine derives once per request from one load (SLN-457): his mean
 * rating C over taste evidence only, the base rate of 4-or-more, the
 * taxonomy's IDF over every book, his taste profile and the series.
 */

export function buildContext(load: SuggestLoad): SuggestContext {
  const byId = new Map(load.books.map((b) => [b.id, b]));
  const rated = load.books.filter((b) => b.taste !== null);
  const meanTaste = rated.length ? rated.reduce((s, b) => s + b.taste!, 0) / rated.length : null;
  const liked = rated.filter((b) => b.taste! >= 4).length;
  const df = new Map<string, number>();
  for (const b of load.books) for (const key of new Set(b.terms.map((t) => t.key))) df.set(key, (df.get(key) ?? 0) + 1);
  const n = load.books.length;
  const idf = new Map([...df].map(([key, count]) => [key, Math.log((n + 1) / (count + 1))]));
  const profile = new Map<string, number>();
  if (meanTaste !== null) for (const b of rated) for (const key of new Set(b.terms.map((t) => t.key))) profile.set(key, (profile.get(key) ?? 0) + (b.taste! - meanTaste));
  const series = new Map<string, NonNullable<ReturnType<SuggestContext["series"]["get"]>>>();
  for (const b of load.books)
    if (b.seriesId) {
      const volumes = series.get(b.seriesId) ?? [];
      volumes.push({ id: b.id, title: b.title, slug: b.slug, position: b.seriesPosition, finished: b.finishedCount > 0, taste: b.taste });
      series.set(b.seriesId, volumes);
    }
  return { ...load, byId, rated, meanTaste, baseLiked: (liked + 1) / (rated.length + 2), idf, profile, series };
}

const editions = new WeakMap<SuggestBook, Map<string | null, QueueEdition | null>>();

/** The edition he would read at the remembered home (as in Up Next): the queued one, else the Start dialog's default */
export function bookEdition(book: SuggestBook, ctx: Pick<SuggestContext, "homeId">): QueueEdition | null {
  const byHome = editions.get(book) ?? new Map<string | null, QueueEdition | null>();
  editions.set(book, byHome);
  if (!byHome.has(ctx.homeId)) byHome.set(ctx.homeId, queueEdition(book.editions, book.queueEditionId, ctx.homeId));
  return byHome.get(ctx.homeId)!;
}

/** The book's length: the page count of that edition */
export function bookPages(book: SuggestBook, ctx: Pick<SuggestContext, "homeId">): number | null {
  return bookEdition(book, ctx)?.pageCount ?? null;
}

/** Whole days from a to b, YYYY-MM-DD */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
