"use server";

import {
  relatedBookRows,
  relatedGroupsFrom,
  type RelatedBookGroup,
} from "@/lib/catalogue/related-groups";

export type { RelatedBookGroup };

/** Independent creator/publishing rows; deduplicate before each group's LIMIT. */
export async function getBookRelatedGroups(
  workId: string,
  limit = 12,
): Promise<RelatedBookGroup[]> {
  return relatedGroupsFrom(await relatedBookRows(workId, limit));
}
