import { bookEdition, bookPages, daysBetween } from "./build";
import { FEATURES, FEATURE_WEIGHTS, type Evidence, type Feature, type FeatureKey } from "./features";
import type { SuggestionParams } from "./params";
import type { SuggestBook, SuggestContext } from "./types";

/*
 * Scoring, reasons, candidates and diversity (SLN-457). A book's score is
 * the weighted sum of the features that have data for it; a reason shows
 * when its feature gives at least REASON_SHARE of the score and meets its
 * evidence threshold. Then maximal marginal relevance (λ = 0.7) keeps the
 * top of the list varied.
 */

export const REASON_SHARE = 0.15;
export const MAX_REASONS = 3;
export const MMR_LAMBDA = 0.7;
/** Not now hides a book this many days by default */
export const NOT_NOW_DAYS = 30;
/** Two rejections of one author within this many days pause the author as long */
export const AUTHOR_PAUSE_DAYS = 30;

export interface Contribution {
  key: FeatureKey;
  label: string;
  weight: number;
  score: number;
  /** weight × score */
  value: number;
  /** value / the book's score */
  share: number;
  reason: string | null;
  meets: boolean;
  evidence: Evidence[];
  factor?: number;
}

export interface Scored {
  book: SuggestBook;
  score: number;
  contributions: Contribution[];
  reasons: string[];
}

export function scoreBook(book: SuggestBook, ctx: SuggestContext, features: Feature[] = FEATURES): Scored {
  const found = features.flatMap((f) => {
    const r = f.compute(book, ctx);
    return r ? [{ ...r, key: f.key, label: f.label, weight: FEATURE_WEIGHTS[f.key] }] : [];
  });
  const factor = found.reduce((p, r) => p * (r.factor ?? 1), 1);
  const raw = found.reduce((s, r) => s + r.weight * r.score, 0);
  const score = raw * factor;
  const contributions = found.map((r) => ({ ...r, value: r.weight * r.score, share: raw ? (r.weight * r.score) / raw : 0 }));
  return { book, score, contributions, reasons: reasonsOf(contributions) };
}

/** The reasons to show: at least REASON_SHARE of the score and over their threshold, the strongest first, three at most */
export function reasonsOf(contributions: Contribution[]): string[] {
  return contributions
    .filter((c) => c.reason && c.meets && c.share >= REASON_SHARE)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_REASONS)
    .map((c) => c.reason!);
}

/* ── Who is a candidate ─────────────────────────────────────────────────── */

/** Hidden by his feedback: Never and Not for me until removed, Not now until its day */
export function hiddenByFeedback(book: SuggestBook, today: string): boolean {
  const f = book.feedback;
  if (!f) return false;
  if (f.verdict !== "not_now") return true;
  return f.until === null || f.until > today;
}

/** Authors paused by two rejections within AUTHOR_PAUSE_DAYS, until AUTHOR_PAUSE_DAYS after the second */
export function pausedAuthors(ctx: SuggestContext): Map<string, { name: string; until: string }> {
  const byAuthor = new Map<string, { name: string; days: string[] }>();
  for (const b of ctx.books)
    if (b.feedback?.verdict === "rejected")
      for (const a of b.authors) {
        const entry = byAuthor.get(a.id) ?? { name: a.name, days: [] };
        entry.days.push(b.feedback.updatedAt.slice(0, 10));
        byAuthor.set(a.id, entry);
      }
  const paused = new Map<string, { name: string; until: string }>();
  for (const [id, { name, days }] of byAuthor) {
    const sorted = [...days].sort();
    for (let i = 1; i < sorted.length; i++)
      if (daysBetween(sorted[i - 1], sorted[i]) <= AUTHOR_PAUSE_DAYS) {
        const until = new Date(Date.parse(sorted[i]) + AUTHOR_PAUSE_DAYS * 86_400_000).toISOString().slice(0, 10);
        if (until > ctx.today && (!paused.has(id) || paused.get(id)!.until < until)) paused.set(id, { name, until });
      }
  }
  return paused;
}

/** Books he has not finished and is not reading, not hidden, by no paused author, and not Anathema when that is hidden */
export function candidates(ctx: SuggestContext): SuggestBook[] {
  const paused = pausedAuthors(ctx);
  return ctx.books.filter(
    (b) => b.finishedCount === 0 && !b.open && !hiddenByFeedback(b, ctx.today) && !b.authors.some((a) => paused.has(a.id)) && !(ctx.hideAnathema && b.isPoison),
  );
}

/** The first volume of a series none of whose volumes he has finished */
export function startsNewSeries(book: SuggestBook, ctx: SuggestContext): boolean {
  if (!book.seriesId) return false;
  return !(ctx.series.get(book.seriesId) ?? []).some((v) => v.finished);
}

/** The constraints bar's filters: scope, length, language, a home, work types, new series */
export function passes(book: SuggestBook, ctx: SuggestContext, p: SuggestionParams): boolean {
  if (p.scope === "owned" && !book.owned) return false;
  if (p.scope === "next" && book.queuePlace === null) return false;
  if (p.scope === "wanted" && book.catalogueStatus !== "wanted") return false;
  if (p.length !== "any") {
    const pages = bookPages(book, ctx);
    if (pages === null) return false;
    if (p.length === "short" && pages >= 200) return false;
    if (p.length === "medium" && (pages < 200 || pages > 400)) return false;
    if (p.length === "long" && pages <= 400) return false;
    if (p.length === "about" && p.about !== undefined && (pages < p.about * 0.85 || pages > p.about * 1.15)) return false;
  }
  if (p.lang && bookEdition(book, ctx)?.language !== p.lang) return false;
  if (p.home && !book.atHandHomes.includes(p.home)) return false;
  if (p.skipTypes.length && book.workTypeId && p.skipTypes.includes(book.workTypeId)) return false;
  if (p.noNewSeries && startsNewSeries(book, ctx)) return false;
  return true;
}

/* ── Diversity ─────────────────────────────────────────────────────────── */

/** How alike two suggestions are, 0 to 1: a shared author or series, then the language and the taxonomy */
export function likeness(a: SuggestBook, b: SuggestBook): number {
  if (a.authors.some((x) => b.authors.some((y) => y.id === x.id))) return 1;
  if (a.seriesId && a.seriesId === b.seriesId) return 1;
  let sim = a.originalLanguage && a.originalLanguage === b.originalLanguage ? 0.3 : 0;
  const ta = likenessKeys(a);
  const tb = likenessKeys(b);
  let shared = 0;
  for (const k of ta) if (tb.has(k)) shared++;
  const union = ta.size + tb.size - shared;
  if (union) sim += 0.5 * (shared / union);
  return Math.min(1, sim);
}

/** A book's taxonomy keys for likeness, the language left out: built once per book, as diversify compares every pair */
const keysByBook = new WeakMap<SuggestBook, Set<string>>();
function likenessKeys(book: SuggestBook): Set<string> {
  let keys = keysByBook.get(book);
  if (!keys) keysByBook.set(book, (keys = new Set(book.terms.filter((t) => !t.key.startsWith("l:")).map((t) => t.key))));
  return keys;
}

/** A number from a string (FNV-1a, 32 bits): the same string, the same number */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Equal scores in an order of the day: the same all day, another tomorrow.
 * With no ratings most books score alike, and by title the top ten would
 * always be the books that start with A.
 */
export const dayOrder = (day: string) => (s: Scored) => hash(`${day}:${s.book.id}`);

/** Maximal marginal relevance: each next pick weighs its score (λ) against its likeness to those picked before (1 − λ) */
export function diversify(items: Scored[], lambda = MMR_LAMBDA, tie: (s: Scored) => number = () => 0): Scored[] {
  const max = Math.max(...items.map((i) => i.score), 0);
  const rest = [...items].sort((a, b) => b.score - a.score || tie(a) - tie(b) || a.book.title.localeCompare(b.book.title));
  const picked: Scored[] = [];
  const nearest = new Map(rest.map((i) => [i, 0]));
  while (rest.length) {
    let best = 0,
      bestValue = -Infinity;
    for (let i = 0; i < rest.length; i++) {
      const value = lambda * (max ? rest[i].score / max : 0) - (1 - lambda) * nearest.get(rest[i])!;
      if (value > bestValue) {
        bestValue = value;
        best = i;
      }
    }
    const [next] = rest.splice(best, 1);
    picked.push(next);
    for (const item of rest) nearest.set(item, Math.max(nearest.get(item)!, likeness(item.book, next.book)));
  }
  return picked;
}

/** The suggestions for these constraints: scored, then varied */
export function suggest(ctx: SuggestContext, p: SuggestionParams): Scored[] {
  return diversify(
    candidates(ctx)
      .filter((b) => passes(b, ctx, p))
      .map((b) => scoreBook(b, ctx)),
    MMR_LAMBDA,
    dayOrder(ctx.today),
  );
}

/** A weighted draw: each item's chance follows its weight (at least 0.01); `random` returns 0 to 1 */
export function weightedPick<T>(items: T[], weight: (item: T) => number, random: () => number = Math.random): T | null {
  if (!items.length) return null;
  const total = items.reduce((s, i) => s + Math.max(weight(i), 0.01), 0);
  let at = random() * total;
  for (const item of items) {
    at -= Math.max(weight(item), 0.01);
    if (at <= 0) return item;
  }
  return items.at(-1)!;
}

/** Pick one for me: a weighted draw among the top ten by score, leaving out those already shown */
export function pickOne<T extends { score: number }>(list: T[], key: (item: T) => string, random: () => number = Math.random, exclude: string[] = []): T | null {
  const top = list.slice(0, 10);
  const fresh = top.filter((i) => !exclude.includes(key(i)));
  return weightedPick(fresh.length ? fresh : top, (i) => i.score, random);
}
