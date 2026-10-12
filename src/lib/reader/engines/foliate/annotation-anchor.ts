import { approxSearch } from "./approx-match";

export interface AnnotationTextQuote {
  highlight: string;
  before?: string;
  after?: string;
}
export interface AnnotationQuoteMatch {
  start: number;
  end: number;
  score: number;
  passageScore: number;
}
export type AnnotationQuoteResult =
  | { status: "found"; match: AnnotationQuoteMatch }
  | { status: "missing" | "ambiguous" | "deferred" };

/** Preserve raw UTF-16 range offsets while collapsing whitespace for matching. */
function normalizeWithOffsets(raw: string) {
  const offsets: number[] = [];
  let text = "";
  for (let i = 0; i < raw.length; i++) {
    const space = /\s/.test(raw[i]);
    if (space && text.endsWith(" ")) continue;
    text += space ? " " : raw[i];
    offsets.push(i);
  }
  return { text, offsets };
}

/** Context is at most 64 characters; this bounded edit distance is not book search. */
function contextSimilarity(a: string, b: string) {
  const left = Array.from(a),
    right = Array.from(b);
  if (!right.length) return 1;
  let row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++)
      next.push(
        Math.min(
          next[j] + 1,
          row[j + 1] + 1,
          row[j] + (left[i] === right[j] ? 0 : 1),
        ),
      );
    row = next;
  }
  return Math.max(
    0,
    1 - row[right.length] / Math.max(left.length, right.length),
  );
}

interface MatchingBudget {
  remaining: number;
  signal?: AbortSignal;
}
function matchingBudget(options: {
  maxWork?: number;
  signal?: AbortSignal;
}): MatchingBudget {
  const remaining = options.maxWork ?? 2_000_000;
  if (!Number.isSafeInteger(remaining) || remaining < 1)
    throw new Error("Invalid annotation matching budget");
  return { remaining, signal: options.signal };
}
function spend(budget: MatchingBudget, work: number) {
  if (budget.signal?.aborted || work > budget.remaining) return false;
  budget.remaining -= work;
  return true;
}

/** A bounded pure section match, not a resolver or navigation implementation.
 * A deferred result must be retried in cancellable background work, never
 * interpreted as missing text. Range creation and file/CFI validation remain
 * with the actual adapter. No progression hint turns an ambiguous quote exact.
 */
export function matchAnnotationQuote(
  raw: string,
  quote: AnnotationTextQuote,
  options: { maxWork?: number; signal?: AbortSignal } = {},
): AnnotationQuoteResult {
  return matchWithBudget(raw, quote, matchingBudget(options));
}

/** A single budget for an adapter's asynchronous section scan. Reading new
 * sections does not renew the synchronous matcher's bounded work allowance. */
export function createAnnotationQuoteMatcher(
  options: { maxWork?: number; signal?: AbortSignal } = {},
) {
  const budget = matchingBudget(options);
  return (raw: string, quote: AnnotationTextQuote): AnnotationQuoteResult =>
    matchWithBudget(raw, quote, budget);
}

function matchWithBudget(
  raw: string,
  quote: AnnotationTextQuote,
  budget: MatchingBudget,
): AnnotationQuoteResult {
  // Reserve normalization plus the exact scan before either synchronous call.
  if (!spend(budget, raw.length * 2)) return { status: "deferred" };
  const { text, offsets } = normalizeWithOffsets(raw);
  const passage = quote.highlight.replace(/\s+/g, " ").trim();
  const before = (quote.before ?? "").replace(/\s+/g, " ");
  const after = (quote.after ?? "").replace(/\s+/g, " ");
  if (
    Array.from(before).length > 64 ||
    Array.from(after).length > 64 ||
    Array.from(passage).length > 10_000
  )
    throw new Error("Annotation quote exceeds its matching limits");
  if (!passage) return { status: "missing" };
  const candidates: { start: number; end: number; errors: number }[] = [];
  for (let from = 0; from <= text.length - passage.length; ) {
    const start = text.indexOf(passage, from);
    if (start < 0) break;
    candidates.push({ start, end: start + passage.length, errors: 0 });
    if (candidates.length > 64) return { status: "deferred" };
    from = start + 1;
  }
  if (!candidates.length && Array.from(passage).length >= 4) {
    // The Myers matcher is synchronous. Refuse an expensive whole-section call
    // rather than falsely promise that requestIdleCallback can make it bounded.
    const errors = Math.floor(Array.from(passage).length * 0.15);
    const blocks = Math.ceil(passage.length / 32);
    // Include worst-case character-mask setup and reverse start resolution for
    // every possible end. The shared matcher has no internal cancellation or
    // candidate cap, so an expected-time estimate alone would not bound it.
    const setup = passage.length * passage.length;
    const estimatedWork =
      setup +
      text.length * blocks +
      text.length * (setup + (passage.length + errors) * blocks);
    if (!spend(budget, estimatedWork)) return { status: "deferred" };
    candidates.push(...approxSearch(text, passage, errors));
    if (candidates.length > 64) return { status: "deferred" };
  }
  const matches: AnnotationQuoteMatch[] = [];
  for (const candidate of candidates) {
    const contextWork =
      before.length * before.length + after.length * after.length;
    if (!spend(budget, contextWork)) return { status: "deferred" };
    const passageScore = 1 - candidate.errors / Array.from(passage).length;
    const prefix = text.slice(
      Math.max(0, candidate.start - before.length),
      candidate.start,
    );
    const suffix = text.slice(candidate.end, candidate.end + after.length);
    const score =
      0.6 * passageScore +
      0.2 * contextSimilarity(prefix, before) +
      0.2 * contextSimilarity(suffix, after);
    if (passageScore < 0.85 || score + 1e-12 < 0.85) continue;
    const start = offsets[candidate.start],
      end = offsets[candidate.end - 1] + 1;
    if (start === undefined || !Number.isFinite(end)) continue;
    matches.push({ start, end, score, passageScore });
  }
  matches.sort((a, b) => b.score - a.score);
  if (!matches.length) return { status: "missing" };
  if (matches[1] && matches[0].score - matches[1].score < 0.01)
    return { status: "ambiguous" };
  return { status: "found", match: matches[0] };
}

export function findAnnotationQuote(
  sections: { href: string; text: string; sectionIndex: number }[],
  quote: AnnotationTextQuote,
  href: string,
  options: { maxWork?: number; signal?: AbortSignal } = {},
) {
  const budget = matchingBudget(options);
  const preferred = sections.filter((section) => section.href === href);
  if (preferred.length > 1)
    throw new Error("Duplicate annotation section href");
  if (preferred[0]) {
    const result = matchWithBudget(preferred[0].text, quote, budget);
    if (result.status === "found")
      return { ...result, href, sectionIndex: preferred[0].sectionIndex };
    if (result.status !== "missing") return result;
  }
  const found: {
    status: "found";
    match: AnnotationQuoteMatch;
    href: string;
    sectionIndex: number;
  }[] = [];
  let deferred = false,
    ambiguous = false;
  for (const section of sections) {
    if (section.href === href) continue;
    const result = matchWithBudget(section.text, quote, budget);
    if (result.status === "found")
      found.push({
        ...result,
        href: section.href,
        sectionIndex: section.sectionIndex,
      });
    else if (result.status === "deferred") deferred = true;
    else if (result.status === "ambiguous") ambiguous = true;
  }
  if (deferred) return { status: "deferred" as const };
  if (ambiguous) return { status: "ambiguous" as const };
  found.sort((a, b) => b.match.score - a.match.score);
  if (found[1] && found[0].match.score - found[1].match.score < 0.01)
    return { status: "ambiguous" as const };
  return found[0] ?? { status: "missing" as const };
}

/** Missing highlighted text is orphaned, even when a stored fraction exists. */
export function annotationAnchorState(input: {
  kind: "highlight" | "bookmark";
  exactRangeVerified: boolean;
  quote: "found" | "missing" | "ambiguous" | "unavailable" | "deferred";
  fractionAvailable: boolean;
}): "exact" | "healed" | "approximate" | "orphaned" | "pending" {
  if (input.exactRangeVerified) return "exact";
  if (input.quote === "deferred") return "pending";
  if (input.quote === "found") return "healed";
  if (input.kind === "highlight" && input.quote !== "unavailable")
    return "orphaned";
  return input.fractionAvailable ? "approximate" : "orphaned";
}
