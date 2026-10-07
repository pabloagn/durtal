import type { ExtractDimension } from "./request";

/*
 * Conflicts (SLN-469, section 4), over every verified value of a book and
 * dimension, also one that fails R6. A conflict never drops a value: each
 * conflicting value is proposed with a note naming the other value and its
 * source, and its confidence is capped. A `terms` dimension (tone, content
 * warnings) may hold several values: two of its terms conflict only when the
 * seed marks them exclusive.
 */

export interface OtherValue {
  term: string;
  method: "api" | "agent" | "human";
  status: "proposed" | "accepted";
  /** Where it came from, for the note: an outlet, an API or Pablo */
  source: string;
}

/** Notes per verified term that conflicts, naming the other value and its source */
export function conflictsOf(dimension: ExtractDimension, verified: Map<string, string>, others: OtherValue[]): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  const add = (term: string, other: string, source: string) => notes.set(term, [...(notes.get(term) ?? []), `conflicts with ${other} (${source})`]);
  const terms = [...verified.keys()];
  // A scale's points, in order
  const point = new Map(
    [...dimension.terms]
      .filter((t) => t.scaleValue !== null)
      .sort((a, b) => a.scaleValue! - b.scaleValue!)
      .map((t, i) => [t.key, i]),
  );
  const exclusive = (a: string, b: string) => dimension.exclusive.some((group) => group.includes(a) && group.includes(b));
  for (const a of terms)
    for (const b of terms) {
      if (a === b) continue;
      const apart =
        dimension.valueKind === "term" ||
        (dimension.valueKind === "scale" && Math.abs((point.get(a) ?? 0) - (point.get(b) ?? 0)) >= 2) ||
        exclusive(a, b);
      if (apart) add(a, b, verified.get(b)!);
    }
  for (const a of terms)
    for (const o of others) {
      if (o.term === a) continue;
      // An exclusive term open or accepted for the book, whatever its method
      const byExclusion = exclusive(a, o.term);
      // A single value that differs from another method's open or accepted one
      const byMethod = o.method !== "agent" && dimension.valueKind !== "terms";
      if (byExclusion || byMethod) add(a, o.term, o.source);
    }
  return notes;
}
