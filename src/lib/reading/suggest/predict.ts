import type { PredictionGate } from "@/lib/validations/settings";
import { formatRating } from "@/lib/utils/rating";
import type { SuggestBook, SuggestContext } from "./types";

/*
 * The predicted rating (SLN-457): the k nearest books with taste evidence,
 * by a similarity of shared author (strongest), series, translator,
 * recommender, taxonomy, language, century and work type. Shown only with
 * at least three neighbours and a total similarity of 1, and only while the
 * gate is on: at least 30 rated books and a leave-one-out error at least 10%
 * below that of his plain average, checked once a day.
 */

export const K = 10;
export const MIN_SIMILARITY = 0.1;
export const MIN_NEIGHBOURS = 3;
export const MIN_TOTAL_SIMILARITY = 1;
export const GATE_MIN_BOOKS = 30;
export const GATE_RATIO = 0.9;
export const GATE_HOURS = 24;

/** Similarity parts: one table, capped at 1 in all */
const PARTS = { author: 0.6, series: 0.3, translator: 0.2, recommender: 0.15, taxonomy: 0.4, language: 0.1, century: 0.1, workType: 0.05 } as const;

const shares = <T>(a: T[], b: T[]) => a.some((x) => b.includes(x));
const termOf = (b: SuggestBook, prefix: string) => b.terms.find((t) => t.key.startsWith(prefix))?.key ?? null;
const FINE = ["s:", "t:", "m:", "c:", "a:", "k:"];

/** IDF-weighted cosine of two books' taxonomy terms (no language, century or work type), 0 to 1 */
function taxonomyLikeness(a: SuggestBook, b: SuggestBook, ctx: Pick<SuggestContext, "idf">): number {
  const fine = (x: SuggestBook) => new Map(x.terms.filter((t) => FINE.some((p) => t.key.startsWith(p))).map((t) => [t.key, ctx.idf.get(t.key) ?? 0]));
  const ta = fine(a),
    tb = fine(b);
  let dot = 0,
    na = 0,
    nb = 0;
  for (const [k, w] of ta) {
    na += w * w;
    if (tb.has(k)) dot += w * tb.get(k)!;
  }
  for (const w of tb.values()) nb += w * w;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** How alike two books are for a prediction, 0 to 1. No author gender or nationality */
export function similarity(a: SuggestBook, b: SuggestBook, ctx: Pick<SuggestContext, "idf">): number {
  let sim = 0;
  if (shares(a.authors.map((x) => x.id), b.authors.map((x) => x.id))) sim += PARTS.author;
  if (a.seriesId && a.seriesId === b.seriesId) sim += PARTS.series;
  if (shares(a.translatorIds, b.translatorIds)) sim += PARTS.translator;
  if (shares(a.recommenders.map((r) => r.id), b.recommenders.map((r) => r.id))) sim += PARTS.recommender;
  sim += PARTS.taxonomy * taxonomyLikeness(a, b, ctx);
  if (a.originalLanguage && a.originalLanguage === b.originalLanguage) sim += PARTS.language;
  const ca = termOf(a, "cy:");
  if (ca && ca === termOf(b, "cy:")) sim += PARTS.century;
  if (a.workTypeId && a.workTypeId === b.workTypeId) sim += PARTS.workType;
  return Math.min(1, sim);
}

export interface Neighbour {
  book: SuggestBook;
  similarity: number;
  rating: number;
}

export interface Prediction {
  value: number;
  /** The half-star range: "likely 4 to 4.5" */
  low: number;
  high: number;
  neighbours: Neighbour[];
}

/** A prediction from `rated` around the mean `c`, or null without enough similar books */
export function predictFrom(book: SuggestBook, rated: SuggestBook[], c: number, ctx: Pick<SuggestContext, "idf">): Prediction | null {
  const neighbours = rated
    .filter((b) => b.id !== book.id)
    .map((b) => ({ book: b, similarity: similarity(book, b, ctx), rating: b.taste! }))
    .filter((x) => x.similarity > MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity || a.book.title.localeCompare(b.book.title))
    .slice(0, K);
  const total = neighbours.reduce((s, x) => s + x.similarity, 0);
  if (neighbours.length < MIN_NEIGHBOURS || total < MIN_TOTAL_SIMILARITY) return null;
  const value = Math.max(0.5, Math.min(5, c + neighbours.reduce((s, x) => s + x.similarity * (x.rating - c), 0) / total));
  return { value, low: Math.max(0.5, Math.floor(value * 2) / 2), high: Math.min(5, Math.ceil(value * 2) / 2), neighbours };
}

/** His predicted rating of a book, from every book with taste evidence */
export function predict(book: SuggestBook, ctx: SuggestContext): Prediction | null {
  return ctx.meanTaste === null ? null : predictFrom(book, ctx.rated, ctx.meanTaste, ctx);
}

/** "likely 4 to 4.5", "likely 4.5" */
export function predictionText(p: Pick<Prediction, "low" | "high">): string {
  return p.low === p.high ? `likely ${formatRating(p.low)}` : `likely ${formatRating(p.low)} to ${formatRating(p.high)}`;
}

/** "from 6 books you rated: Là-bas 4.5, À rebours 4, …" */
export function predictionSource(p: Prediction): string {
  const shown = p.neighbours.slice(0, 3).map((x) => `${x.book.title} ${formatRating(x.rating)}`);
  return `from ${p.neighbours.length} books you rated: ${shown.join(", ")}${p.neighbours.length > 3 ? ", …" : ""}`;
}

export interface Evaluation {
  /** Books with a finished reading and taste evidence */
  n: number;
  /** The share of them that got a prediction from the others */
  coverage: number;
  /** Over the books that got one: the prediction's error, and that of the mean of the others */
  mae: number | null;
  baselineMae: number | null;
}

/** Leave-one-out over the rated books: each predicted from the others, against the mean of the others */
export function evaluatePredictions(ctx: Pick<SuggestContext, "rated" | "idf">): Evaluation {
  const rated = ctx.rated;
  const sum = rated.reduce((s, b) => s + b.taste!, 0);
  let errors = 0,
    baseline = 0,
    predicted = 0;
  for (const book of rated) {
    if (rated.length < 2) break;
    const c = (sum - book.taste!) / (rated.length - 1);
    const p = predictFrom(book, rated, c, ctx);
    if (!p) continue;
    predicted++;
    errors += Math.abs(p.value - book.taste!);
    baseline += Math.abs(c - book.taste!);
  }
  return {
    n: rated.length,
    coverage: rated.length ? predicted / rated.length : 0,
    mae: predicted ? errors / predicted : null,
    baselineMae: predicted ? baseline / predicted : null,
  };
}

/** The check passes: at least 30 rated books, and an error at least 10% below the baseline's */
export function passesGate(e: Evaluation): boolean {
  return e.n >= GATE_MIN_BOOKS && e.mae !== null && e.baselineMae !== null && e.mae <= GATE_RATIO * e.baselineMae;
}

/** The gate after today's check: on after one pass; once on, off only after two failing checks in a row */
export function nextGate(previous: PredictionGate | null, e: Evaluation, now: Date): PredictionGate {
  const pass = passesGate(e);
  const failures = pass ? 0 : (previous?.on ? previous.failures + 1 : 0);
  const on = pass || (!!previous?.on && failures < 2);
  return { checkedAt: now.toISOString(), on, failures: on ? failures : 0, n: e.n, coverage: e.coverage, mae: e.mae, baselineMae: e.baselineMae };
}

/** The check is due: never run, or run 24 hours ago or more */
export function gateDue(previous: PredictionGate | null, now: Date): boolean {
  return !previous || now.getTime() - Date.parse(previous.checkedAt) >= GATE_HOURS * 3_600_000;
}
