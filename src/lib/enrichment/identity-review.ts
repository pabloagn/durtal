import { z } from "zod";
import { validIsbn13 } from "@/lib/match/plan";
import { ID_PATTERNS } from "./identity";

/*
 * Pablo's identity decisions (SLN-464), by work slug, until the review inbox
 * (SLN-470) replaces this file. Each entry repeats the book's title as a
 * guard, decides one or more dimensions, and says why. A value accepts that
 * proposal (or records Pablo's own, looked up at its source first); null
 * rejects every open proposal of the dimension. The LCCN is decided per
 * edition, by its ISBN-13. Every report ends with ready entries for the
 * books that need one; only Pablo fills in the decision.
 */

export interface IdentityReviewEntry {
  title: string;
  wikidata_qid?: string | null;
  open_library_work?: string | null;
  oclc_work?: string | null;
  /** By the edition's ISBN-13 */
  lccn?: Record<string, string | null>;
  note: string;
}

export const IDENTITY_REVIEW: Record<string, IdentityReviewEntry> = {};

const id = (pattern: RegExp) => z.string().regex(pattern).nullable().optional();
const entrySchema = z
  .object({
    title: z.string().trim().min(1),
    wikidata_qid: id(ID_PATTERNS.wikidata_qid),
    open_library_work: id(ID_PATTERNS.open_library_work),
    oclc_work: id(ID_PATTERNS.oclc_work),
    lccn: z
      .record(
        z.string().refine((isbn) => validIsbn13(isbn) === isbn, "An LCCN is decided by the edition's ISBN-13"),
        z.string().regex(ID_PATTERNS.lccn, "An LCCN in its normalised form").nullable(),
      )
      .optional(),
    note: z.string().trim().min(1, "Every decision says why"),
  })
  .strict()
  .refine((e) => ["wikidata_qid", "open_library_work", "oclc_work", "lccn"].some((k) => k in e), "An entry decides at least one dimension");

export const identityReviewSchema = z.record(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), entrySchema);

/** The decisions of one entry, in the order they are applied: the QID first */
export function entryDecisions(entry: IdentityReviewEntry) {
  return [
    ...(["wikidata_qid", "open_library_work", "oclc_work"] as const)
      .filter((d) => entry[d] !== undefined)
      .map((dimension) => ({ dimension, isbn: null as string | null, value: entry[dimension] as string | null })),
    ...Object.entries(entry.lccn ?? {}).map(([isbn, value]) => ({ dimension: "lccn" as const, isbn: isbn as string | null, value })),
  ];
}
