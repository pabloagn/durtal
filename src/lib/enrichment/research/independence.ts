import { sameText, type Fingerprint } from "../fingerprint";
import type { OUTLET_KINDS } from "../outlets";

/*
 * R6 (SLN-469, section 4): the only rule in the code that counts independent
 * sources. SLN-470, SLN-471 and SLN-473 call it; no other code counts
 * syndication groups. Agreeing documents are one source when they share an
 * outlet, a syndication group, a byline, near-duplicate text, or a quote (an
 * excerpt of one contains an excerpt of the other); merging is transitive.
 * Publisher and translator pages add evidence but never count toward the two.
 * Evidence of human claims is Pablo's own answer and is left out.
 */

export interface EvidenceRow {
  sourceRecordId: string;
  /** The claim's method: a human claim's evidence never counts */
  method: "api" | "agent" | "human";
  outlet: string;
  outletKind: (typeof OUTLET_KINDS)[number] | null;
  /** The outlet's weight, 0 to 1 */
  weight: number;
  syndicationGroup: string | null;
  byline: string | null;
  fingerprint: Fingerprint | null;
  excerpt: string;
}

export interface IndependentSource {
  rows: EvidenceRow[];
  /** The highest weight of its documents */
  weight: number;
  /** False for a source of publisher and translator pages only */
  counts: boolean;
}

/** Case and punctuation folded, as the fingerprint folds them: for the quote rule */
const fold = (text: string) =>
  text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const byline = (text: string | null) => text?.normalize("NFC").trim().toLowerCase() || null;

function oneSource(a: EvidenceRow, b: EvidenceRow) {
  if (a.sourceRecordId === b.sourceRecordId || a.outlet === b.outlet) return true;
  if (a.syndicationGroup && a.syndicationGroup === b.syndicationGroup) return true;
  if (byline(a.byline) && byline(a.byline) === byline(b.byline)) return true;
  if (a.fingerprint && b.fingerprint && a.fingerprint.method === b.fingerprint.method && sameText(a.fingerprint, b.fingerprint).same) return true;
  const [fa, fb] = [fold(a.excerpt), fold(b.excerpt)];
  return Boolean(fa && fb && (fa.includes(fb) || fb.includes(fa)));
}

/** The independent sources of some evidence of one value, their count (publisher and translator pages left out) and whether two count */
export function checkIndependence(rows: EvidenceRow[]) {
  const evidence = rows.filter((r) => r.method !== "human");
  // Union-find over the documents
  const parent = evidence.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < evidence.length; i++)
    for (let j = i + 1; j < evidence.length; j++) if (oneSource(evidence[i], evidence[j])) parent[root(i)] = root(j);
  const groups = new Map<number, EvidenceRow[]>();
  evidence.forEach((row, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), row]));
  const sources: IndependentSource[] = [...groups.values()].map((group) => ({
    rows: group,
    weight: Math.max(...group.map((r) => r.weight)),
    counts: group.some((r) => r.outletKind !== "publisher" && r.outletKind !== "translator"),
  }));
  const count = sources.filter((s) => s.counts).length;
  return { sources, count, passes: count >= 2 };
}
