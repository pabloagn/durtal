import { formatOfCopy } from "../constants";
import { formatMinutes } from "../positions";
import { queueWhereabouts, timeToRead, timeToReadText } from "../queue";
import { bookEdition, bookPages } from "./build";
import type { Evidence, FeatureKey } from "./features";
import { predict, predictionSource, predictionText } from "./predict";
import type { Scored } from "./score";
import type { SuggestContext } from "./types";

/*
 * A suggestion as the pages show it (SLN-457): slim, so a list of 24 stays
 * within the page budget. Its line reads "320 p. · On your shelf in
 * Amsterdam · About 9 h", as Up Next computes it, without the place when a
 * reason already says it.
 */

export interface WhyPart {
  key: FeatureKey;
  label: string;
  /** Its share of the score, 0 to 1 */
  share: number;
  reason: string | null;
  evidence: Evidence[];
  /** It lowers the whole score (a too_long rejection) */
  lowers: boolean;
}

export interface SuggestionRow {
  workId: string;
  title: string;
  href: string;
  author: string | null;
  cover: string | null;
  editionId: string | null;
  isPoison: boolean;
  line: string;
  reasons: string[];
  /** "likely 4 to 4.5", only while the gate is on */
  prediction: string | null;
  predictionSource: string | null;
  why: WhyPart[];
  score: number;
}

export function suggestionRow(s: Scored, ctx: SuggestContext): SuggestionRow {
  const { book } = s;
  const edition = bookEdition(book, ctx);
  const copy = edition?.copies.find((c) => c.status !== "deaccessioned");
  const format = edition?.audioMinutes ? "audio" : formatOfCopy(copy?.format);
  // The pages the score reads: a count outside 16 to 3,000 shows no length and no time, as no count does
  const pages = bookPages(book, ctx);
  const length = edition?.audioMinutes ? formatMinutes(edition.audioMinutes) : pages ? `${pages} p.` : null;
  const time = timeToReadText(timeToRead(edition && { ...edition, pageCount: pages }, format, ctx.priors));
  const p = ctx.gate?.on ? predict(book, ctx) : null;
  // Said once: when At hand is one of the reasons, the line leaves the copy's place out
  const where = queueWhereabouts(book.editions, book.atHandCopyId, ctx.today);
  return {
    workId: book.id,
    title: book.title,
    href: `/library/${book.slug ?? book.id}`,
    author: book.authors[0]?.name ?? null,
    cover: edition?.thumbnail ?? book.cover ?? book.editions.find((e) => e.thumbnail)?.thumbnail ?? null,
    editionId: edition?.id ?? null,
    isPoison: book.isPoison,
    line: [length, s.reasons.includes(where) ? null : where, time].filter(Boolean).join(" · "),
    reasons: s.reasons,
    prediction: p ? predictionText(p) : null,
    predictionSource: p ? predictionSource(p) : null,
    why: s.contributions.map((c) => ({ key: c.key, label: c.label, share: c.share, reason: c.reason, evidence: c.evidence.slice(0, 6), lowers: (c.factor ?? 1) < 1 })),
    score: s.score,
  };
}
