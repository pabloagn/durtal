import { and, eq } from "drizzle-orm";
import { works, workRecommenders } from "@/lib/db/schema";
import type { CurationOwner } from "./curation";
import type { Db } from "./work-store";

/** Personal curation fields, already validated by the caller's schema. */
export interface CurationWrite {
  notes?: string | null;
  rating?: number | null;
  isFavourite?: boolean;
  recommenderIds?: string[];
}

/** True when the patch changes at least one stored value. */
export function hasCurationChanges(patch: CurationWrite) {
  return Object.values(patch).some((value) => value !== undefined);
}

/**
 * The writes of a curation patch, to run inside one atomic batch with the
 * caller's other writes. Every domain's personal fields and recommendations
 * go through here: the book forms (updateWork, createWork) and the shared
 * curation action. A repeated recommender is stored once, so the replacement
 * never fails after it has removed the old recommendations.
 */
export function curationQueries(
  d: Db,
  owner: CurationOwner,
  { recommenderIds, ...fields }: CurationWrite,
) {
  const values = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  const recommendations = recommenderIds && [...new Set(recommenderIds)];
  return [
    // A change of recommendations alone still marks the work as edited
    ...(Object.keys(values).length || recommendations
      ? [
          d
            .update(works)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(works.id, owner.id), eq(works.kind, owner.kind))),
        ]
      : []),
    ...(recommendations
      ? [
          d.delete(workRecommenders).where(eq(workRecommenders.workId, owner.id)),
          ...(recommendations.length
            ? [
                d.insert(workRecommenders).values(
                  recommendations.map((recommenderId) => ({
                    workId: owner.id,
                    recommenderId,
                  })),
                ),
              ]
            : []),
        ]
      : []),
  ];
}
