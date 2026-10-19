"use server";

import type { SimilarWork } from "@/lib/catalogue/related-tiles";
import { rankSimilarWorks, similarWorksFrom } from "@/lib/catalogue/similar-ranking";

/** See `rankSimilarWorks` for how similarity is scored */
export async function getSimilarWorks(
  workId: string,
  limit = 12,
): Promise<SimilarWork[]> {
  return similarWorksFrom(await rankSimilarWorks(workId, limit));
}
