/** Review presentation only: this never changes matching tiers or grants permission to link. */
export const REVIEW_SECTIONS = [
  "conflict",
  "likely",
  "to_choose",
  "same_author",
  "duplicate",
  "not_a_book",
  "not_in_durtal",
  "automatic",
  "partially_held",
] as const;
export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

export interface ReviewSectionInput {
  matchState: "pending" | "linked" | "standalone" | "excluded";
  matchTier:
    | "exact"
    | "strong"
    | "likely"
    | "to_choose"
    | "same_author"
    | "conflict"
    | "duplicate"
    | "not_a_book"
    | "not_in_durtal"
    | null;
  matchMethod: "isbn" | "identifier" | "score" | "manual" | "accession" | null;
  matchedAt: string | null;
  /** Joined through instance → edition → work; never inferred from a candidate. */
  workKind: "book" | "film" | "perfume" | "painting" | null;
  catalogueStatus: string | null;
  activeCopy: boolean;
}

/** `now` is supplied once by the page so every section uses the same 30-day boundary. */
export function reviewSectionsFor(
  row: ReviewSectionInput,
  now: Date,
): ReviewSection[] {
  if (!Number.isFinite(now.getTime()))
    throw new Error("A valid review snapshot time is required");
  if (row.matchState === "pending") {
    if (row.matchTier === "exact" || row.matchTier === "strong")
      return ["likely"];
    return [row.matchTier ?? "to_choose"];
  }
  if (row.matchState !== "linked" || row.workKind !== "book") return [];
  const sections: ReviewSection[] = [];
  const matched = row.matchedAt === null ? NaN : Date.parse(row.matchedAt);
  const submillisecond = Number(
    row.matchedAt
      ?.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1]
      .padEnd(6, "0")
      .slice(3) ?? "0",
  );
  if (
    ["isbn", "identifier", "score"].includes(row.matchMethod ?? "") &&
    matched >= now.getTime() - 30 * 24 * 60 * 60 * 1000 &&
    (matched < now.getTime() ||
      (matched === now.getTime() && submillisecond === 0))
  ) {
    sections.push("automatic");
  }
  if (
    row.activeCopy &&
    ["wanted", "shortlisted", "tracked", "on_order"].includes(
      row.catalogueStatus ?? "",
    )
  ) {
    sections.push("partially_held");
  }
  return sections;
}
