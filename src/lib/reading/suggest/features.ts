import { copyWhereabouts } from "../at-hand";
import { ordinal } from "../queue";
import { nextVolume, seriesOrder } from "../series";
import { formatRating } from "@/lib/utils/rating";
import { bookPages, daysBetween } from "./build";
import type { SuggestBook, SuggestContext } from "./types";

/*
 * The suggestion features (SLN-457). Each scores a book from 0 to 1 with a
 * short reason and its evidence, or returns null when it has no data for the
 * book, so it adds nothing. A reason counts only when its evidence meets the
 * feature's threshold (`meets`); the score still counts below it. New
 * features (the book enrichment epic's attributes) join FEATURES as entries.
 */

export type FeatureKey = "series" | "author" | "recommender" | "taste" | "shelf" | "atHand" | "upNext" | "recent" | "feedback";

export interface Evidence {
  label: string;
  href?: string;
  /** The book, recommender or series id behind it (the API returns these) */
  id?: string;
}

export interface FeatureResult {
  score: number;
  reason: string | null;
  /** The reason's evidence threshold is met */
  meets: boolean;
  evidence: Evidence[];
  /** Multiplies the whole score (a too_long rejection lowers longer books) */
  factor?: number;
}

export interface Feature {
  key: FeatureKey;
  label: string;
  compute(book: SuggestBook, ctx: SuggestContext): FeatureResult | null;
}

/** Feature weights: one table, so a change is one line */
export const FEATURE_WEIGHTS: Record<FeatureKey, number> = {
  series: 1,
  author: 0.8,
  taste: 0.7,
  recommender: 0.6,
  upNext: 0.6,
  atHand: 0.5,
  shelf: 0.3,
  recent: 0.3,
  feedback: 0.3,
};

/** Terms that never make a taste reason alone: original language, century and work type */
const COARSE = ["l:", "cy:", "wt:"];
export const isCoarse = (key: string) => COARSE.some((p) => key.startsWith(p));

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const bookHref = (b: Pick<SuggestBook, "id" | "slug">) => `/library/${b.slug ?? b.id}`;
const one = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const possessive = (name: string) => `${name}'s`;
const n = (v: number) => v.toLocaleString("en-US");

/** Rated books and his plain average, for a list of taste evidence */
function average(books: SuggestBook[]) {
  return books.reduce((s, b) => s + b.taste!, 0) / books.length;
}

/** Bayesian mean of a list of ratings, shrunk toward C by two pseudo-ratings */
export function bayesianMean(ratings: number[], c: number) {
  return (ratings.reduce((s, r) => s + r, 0) + 2 * c) / (ratings.length + 2);
}

/** Beta estimate of a recommender's picks rated 4 or more */
export function betaTrust(liked: number, rated: number) {
  return (liked + 1) / (rated + 2);
}

const series: Feature = {
  key: "series",
  label: "Series",
  compute(book, ctx) {
    if (!book.seriesId) return null;
    const volumes = ctx.series.get(book.seriesId) ?? [];
    if (nextVolume(volumes)?.id !== book.id) return null;
    const ordered = seriesOrder(volumes);
    const last = [...ordered].reverse().find((v) => v.finished);
    const name = book.seriesTitle ?? "the series";
    if (!last) return { score: 0.3, reason: `First in ${name}`, meets: true, evidence: [{ label: name, href: `/series/${book.seriesId}`, id: book.seriesId }] };
    const rated = last.taste !== null ? ` (you gave it ${formatRating(last.taste)})` : "";
    return { score: 1, reason: `Next in ${name} after ${last.title}${rated}`, meets: true, evidence: [{ label: last.title, href: bookHref(last), id: last.id }] };
  },
};

const author: Feature = {
  key: "author",
  label: "Author",
  compute(book, ctx) {
    if (ctx.meanTaste === null || !book.authors.length) return null;
    let best: FeatureResult | null = null;
    for (const a of book.authors) {
      const others = ctx.rated.filter((b) => b.id !== book.id && b.authors.some((x) => x.id === a.id));
      if (!others.length) continue;
      const bayes = bayesianMean(
        others.map((b) => b.taste!),
        ctx.meanTaste,
      );
      const score = clamp(0.5 + (bayes - ctx.meanTaste) / 2);
      const result: FeatureResult = {
        score,
        reason: `You rated ${n(others.length)} of ${possessive(a.name)} books ${one(average(others))} on average`,
        meets: others.length >= 2 && bayes > ctx.meanTaste,
        evidence: others.map((b) => ({ label: `${b.title} ${formatRating(b.taste!)}`, href: bookHref(b), id: b.id })),
      };
      if (!best || result.score > best.score) best = result;
    }
    return best;
  },
};

/** Each recommender's picks with taste evidence: rated, and rated 4 or more */
export function recommenderRecord(id: string, ctx: SuggestContext) {
  const picks = ctx.rated.filter((b) => b.recommenders.some((r) => r.id === id));
  return { rated: picks.length, liked: picks.filter((b) => b.taste! >= 4).length, picks };
}

const recommender: Feature = {
  key: "recommender",
  label: "Recommender",
  compute(book, ctx) {
    let best: FeatureResult | null = null;
    for (const r of book.recommenders) {
      const { rated, liked, picks } = recommenderRecord(r.id, ctx);
      if (!rated) continue;
      const trust = betaTrust(liked, rated);
      const result: FeatureResult = {
        score: clamp(0.5 + (trust - ctx.baseLiked)),
        reason: `${r.name} recommended it; you rated ${n(liked)} of their ${n(rated)} picks 4 or more`,
        meets: rated >= 3 && trust > ctx.baseLiked,
        evidence: [
          { label: r.name, href: `/recommenders/${r.id}`, id: r.id },
          ...picks.map((b) => ({ label: `${b.title} ${formatRating(b.taste!)}`, href: bookHref(b), id: b.id })),
        ],
      };
      if (!best || result.score > best.score) best = result;
    }
    return best;
  },
};

/** Cosine between the book's terms (IDF weights) and his taste profile (IDF × profile), from −1 to 1; null without overlap */
export function tasteCosine(keys: Set<string>, ctx: SuggestContext): number | null {
  let dot = 0,
    book = 0,
    shared = 0;
  for (const key of keys) {
    const w = ctx.idf.get(key) ?? 0;
    book += w * w;
    const p = ctx.profile.get(key);
    if (p === undefined || w === 0) continue;
    dot += w * w * p;
    shared++;
  }
  if (!shared || !book) return null;
  let norm = 0;
  for (const [key, p] of ctx.profile) {
    const w = ctx.idf.get(key) ?? 0;
    norm += (w * p) ** 2;
  }
  return norm ? Math.max(-1, Math.min(1, dot / (Math.sqrt(book) * Math.sqrt(norm)))) : null;
}

const taste: Feature = {
  key: "taste",
  label: "Taste",
  compute(book, ctx) {
    if (ctx.meanTaste === null) return null;
    const keys = new Set(book.terms.map((t) => t.key));
    const cos = tasteCosine(keys, ctx);
    if (cos === null) return null;
    // The reason: up to two terms of his liking (not language, century or type alone) that 3 rated books share
    const shared = book.terms
      .filter((t) => !isCoarse(t.key) && (ctx.profile.get(t.key) ?? 0) > 0)
      .map((t) => ({ term: t, books: ctx.rated.filter((b) => b.terms.some((x) => x.key === t.key)) }))
      .filter((s) => s.books.length >= 3)
      .sort((a, b) => (ctx.idf.get(b.term.key) ?? 0) * ctx.profile.get(b.term.key)! - (ctx.idf.get(a.term.key) ?? 0) * ctx.profile.get(a.term.key)!)
      .slice(0, 2);
    const liked = [...new Set(shared.flatMap((s) => s.books).filter((b) => b.taste! >= 4))];
    const names = shared.map((s) => s.term.name);
    return {
      score: clamp((cos + 1) / 2),
      reason: shared.length ? `Shares ${names.join(" and ")} with ${n(liked.length)} ${liked.length === 1 ? "book" : "books"} you rated 4 or more` : null,
      meets: shared.length > 0 && liked.length > 0,
      evidence: liked.map((b) => ({ label: `${b.title} ${formatRating(b.taste!)}`, href: bookHref(b), id: b.id })),
    };
  },
};

const shelf: Feature = {
  key: "shelf",
  label: "Shelf time",
  compute(book, ctx) {
    if (!book.firstAcquired) return null;
    const years = Math.min(10, Math.max(0, daysBetween(book.firstAcquired, ctx.today) / 365.25));
    return { score: years / 10, reason: `On your shelves since ${book.firstAcquired.slice(0, 4)}`, meets: years >= 1, evidence: [] };
  },
};

const atHand: Feature = {
  key: "atHand",
  label: "At hand",
  compute(book, ctx) {
    if (!book.atHandCopyId) return null;
    const copy = book.editions.flatMap((e) => e.copies).find((c) => c.id === book.atHandCopyId);
    if (!copy) return null;
    return { score: 1, reason: copyWhereabouts(copy, { today: ctx.today }), meets: true, evidence: [] };
  },
};

const upNext: Feature = {
  key: "upNext",
  label: "Up Next",
  compute(book, ctx) {
    if (book.queuePlace === null) return null;
    const share = ctx.queueLength > 1 ? (book.queuePlace - 1) / (ctx.queueLength - 1) : 0;
    return { score: 1 - share / 2, reason: `In your Up Next, ${ordinal(book.queuePlace)}`, meets: true, evidence: [{ label: "Up Next", href: "/reading/next" }] };
  },
};

/** "Bought this week", "Bought 3 weeks ago", "Bought last month", "Bought 2 months ago" */
export function boughtText(days: number): string {
  if (days < 7) return "Bought this week";
  if (days < 14) return "Bought last week";
  if (days < 30) return `Bought ${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "Bought last month";
  return "Bought 2 months ago";
}

const recent: Feature = {
  key: "recent",
  label: "Recent copy",
  compute(book, ctx) {
    if (!book.lastAcquired) return null;
    const days = daysBetween(book.lastAcquired, ctx.today);
    if (days < 0 || days > 90) return null;
    return { score: 1 - days / 90, reason: boughtText(days), meets: true, evidence: [] };
  },
};

/** too_long rejections of the last 30 days, with the rejected book's length */
export function tooLongRejections(ctx: SuggestContext) {
  return ctx.books
    .filter((b) => b.feedback?.verdict === "rejected" && b.feedback.reasons.includes("too_long") && daysBetween(b.feedback.updatedAt.slice(0, 10), ctx.today) <= 30)
    .map((b) => ({ book: b, pages: bookPages(b, ctx) }))
    .filter((r): r is { book: SuggestBook; pages: number } => r.pages !== null);
}

const feedback: Feature = {
  key: "feedback",
  label: "Your feedback",
  compute(book, ctx) {
    const rejected = tooLongRejections(ctx).filter((r) => r.book.id !== book.id);
    const pages = bookPages(book, ctx);
    if (!rejected.length || pages === null) return null;
    const longer = rejected.filter((r) => pages > r.pages);
    if (longer.length) {
      const r = longer[0];
      return {
        score: 0,
        reason: `Longer than ${r.book.title}, which you passed on as too long`,
        meets: false,
        evidence: [{ label: r.book.title, href: bookHref(r.book), id: r.book.id }],
        factor: 0.5,
      };
    }
    const r = [...rejected].sort((a, b) => a.pages - b.pages)[0];
    return {
      score: 1,
      reason: `Shorter than ${r.book.title}, which you passed on as too long`,
      meets: true,
      evidence: [{ label: r.book.title, href: bookHref(r.book), id: r.book.id }],
    };
  },
};

/** Every feature, in the order Why this? lists them */
export const FEATURES: Feature[] = [series, author, recommender, taste, shelf, atHand, upNext, recent, feedback];

/** The features that can give a reason with no ratings at all */
export const WITHOUT_RATINGS: FeatureKey[] = ["series", "shelf", "atHand", "upNext", "recent"];
