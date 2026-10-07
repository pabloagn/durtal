import { RESEARCH_CONFIG } from "./config";
import type { Passage } from "./text";

/*
 * The checks of one returned value (SLN-469, section 4), in order; the first
 * that fails drops it, with its reason. R4: a current term of the dimension.
 * R3: the excerpt, put in NFC and nothing else, occurs exactly in the cited
 * passage; its offsets (code points) slice it back out of the stored text.
 * Then its length.
 */

export const VALUE_CHECKS = ["unknown_term", "no_excerpt", "not_in_passage", "excerpt_too_short", "excerpt_too_long"] as const;
export type ValueCheck = (typeof VALUE_CHECKS)[number];

export interface ReturnedValue {
  dimension: string;
  term: string;
  excerpt: string;
  passage: string;
}

export interface VerifiedValue {
  dimension: string;
  term: string;
  /** NFC, exactly the stored text from `start` to `end` */
  excerpt: string;
  start: number;
  end: number;
}

export type Verdict = { ok: true; value: VerifiedValue } | { ok: false; check: ValueCheck };

/**
 * Checks one value against the document's stored text (NFC), the passages
 * sent and the current terms of each dimension.
 */
export function verifyValue(value: ReturnedValue, input: { chars: string[]; passages: Passage[]; terms: Map<string, Set<string>> }): Verdict {
  // R4: a current term of that dimension
  if (!input.terms.get(value.dimension)?.has(value.term)) return { ok: false, check: "unknown_term" };
  // R3: NFC is the only change; a passage the request did not send fails
  const excerpt = value.excerpt.normalize("NFC");
  if (!excerpt) return { ok: false, check: "no_excerpt" };
  const passage = input.passages.find((p) => p.id === value.passage);
  if (!passage) return { ok: false, check: "not_in_passage" };
  const at = passage.text.indexOf(excerpt);
  if (at < 0) return { ok: false, check: "not_in_passage" };
  const start = passage.start + [...passage.text.slice(0, at)].length;
  const length = [...excerpt].length;
  const end = start + length;
  if (input.chars.slice(start, end).join("") !== excerpt) throw new Error("A verified excerpt does not slice back out of its stored text");
  if (length < RESEARCH_CONFIG.minExcerptChars) return { ok: false, check: "excerpt_too_short" };
  if (length > RESEARCH_CONFIG.maxExcerptChars) return { ok: false, check: "excerpt_too_long" };
  return { ok: true, value: { dimension: value.dimension, term: value.term, excerpt, start, end } };
}
