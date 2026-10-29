import type { ReviewQueue } from "./types";

/** A readable summary of non-empty sections, with one separator style. */
export function reviewSummary(counts: ReviewQueue["counts"]): string | undefined {
  const pending = Object.entries(counts).filter(([key]) => key !== "automatic" && key !== "partially_held")
    .reduce((sum, [, count]) => sum + count, 0);
  const parts = [
    pending ? `${pending.toLocaleString("en")} to review` : null,
    counts.not_in_durtal ? `${counts.not_in_durtal.toLocaleString("en")} not in Durtal` : null,
    counts.automatic ? `${counts.automatic.toLocaleString("en")} linked automatically` : null,
    counts.partially_held ? `${counts.partially_held.toLocaleString("en")} linked to books you don’t own yet` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}
