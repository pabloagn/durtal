import type { MatchCatalogue } from "./catalogue";
import type { MatchResult, MatchTier, Reason } from "./types";

/*
 * One book, one e-book (SLN-657). Within one scoring scope, an e-book never
 * links by itself when another e-book proposes the same book, when it scores
 * for several books (an omnibus or a collected edition), or when its book
 * already has an e-book. It goes to review with the reason, where Joris keeps
 * one or keeps them as different editions. Tiers, candidates and effects stay
 * as scored: this only takes automatic links away, never adds one.
 */

export type Clash = "several_ebooks" | "several_works" | "has_ebook";

export const CLASH_REASONS: Record<Clash, Reason> = {
  several_ebooks: { code: "several_ebooks", text: "Several e-books propose this book: keep one, or keep them as different editions" },
  several_works: { code: "several_works", text: "This e-book scores for several books: an omnibus or a collected edition?" },
  has_ebook: { code: "has_ebook", text: "This book already has an e-book: keep one, or keep both as different editions" },
};

/** The tiers whose leading candidate is a proposal for that book */
const PROPOSING: readonly MatchTier[] = ["exact", "strong", "likely", "to_choose", "conflict"];

/** The book an e-book proposes: its leading candidate, in a proposing tier */
export function proposedWork(result: MatchResult): string | null {
  return !result.skipped && result.tier && PROPOSING.includes(result.tier) ? (result.candidates[0]?.workId ?? null) : null;
}

/** Each result's clashes, by e-book id; e-books without one are left out */
export function findClashes(results: readonly MatchResult[], catalogue: MatchCatalogue): Map<string, Clash[]> {
  const proposers = new Map<string, Set<string>>();
  const propose = (workId: string, ebookId: string) => proposers.set(workId, (proposers.get(workId) ?? new Set()).add(ebookId));
  const ids = new Set(results.map((result) => result.ebookId));
  for (const result of results) {
    const workId = proposedWork(result);
    if (workId) propose(workId, result.ebookId);
  }
  // A duplicate of an e-book in the same scope proposes what that one proposes
  for (const result of results) {
    if (result.tier !== "duplicate" || !result.duplicateOfId || !ids.has(result.duplicateOfId)) continue;
    const workId = proposedWork(results.find((other) => other.ebookId === result.duplicateOfId)!);
    if (workId) propose(workId, result.ebookId);
  }
  const clashes = new Map<string, Clash[]>();
  for (const result of results) {
    const workId = proposedWork(result);
    if (!workId) continue;
    const found: Clash[] = [];
    if (proposers.get(workId)!.size > 1) found.push("several_ebooks");
    if (result.candidates.length > 1 || result.flags.includes("omnibus")) found.push("several_works");
    if (catalogue.byWorkId.get(workId)?.source.copies.some((copy) => copy.linkedEbookId && copy.linkedEbookId !== result.ebookId)) found.push("has_ebook");
    if (found.length) clashes.set(result.ebookId, found);
  }
  return clashes;
}

/** A result sent to review: no automatic link, the reasons first, its tier and candidates as scored */
function toReview(result: MatchResult, reasons: readonly Reason[]): MatchResult {
  return {
    ...result,
    autoLink: false,
    reasons: [...reasons, ...result.reasons],
    candidates: result.candidates.map((candidate, i) => (i === 0 ? { ...candidate, reasons: [...reasons, ...candidate.reasons] } : candidate)),
  };
}

/** The results with every clashing e-book sent to review, its reasons first */
export function oneEbookPerWork(results: readonly MatchResult[], catalogue: MatchCatalogue): MatchResult[] {
  const clashes = findClashes(results, catalogue);
  return results.map((result) => {
    const found = clashes.get(result.ebookId);
    return found ? toReview(result, found.map((clash) => CLASH_REASONS[clash])) : result;
  });
}

/** The results with the e-books a wider look already sent to review held there, with its reason */
export function holdForReview(results: readonly MatchResult[], held: ReadonlyMap<string, Reason>): MatchResult[] {
  return results.map((result) => {
    const reason = held.get(result.ebookId);
    return reason && !result.skipped ? toReview(result, [reason]) : result;
  });
}
