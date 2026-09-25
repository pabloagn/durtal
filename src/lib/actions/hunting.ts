"use server";

import { z } from "zod";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";
import {
  huntAssessmentSchema,
  type HuntAssessmentInput,
} from "@/lib/validations/hunting";

export async function updateHuntAssessment(
  workId: string,
  input: HuntAssessmentInput,
) {
  const id = z.uuid().parse(workId);
  const assessment = huntAssessmentSchema.parse(input);
  // One write keeps the marker and its date together. No lifecycle fields change.
  const [updated] = await db
    .update(works)
    .set({ ...assessment, updatedAt: new Date() })
    .where(eq(works.id, id))
    .returning({ id: works.id });
  if (!updated) throw new Error("Book not found");
  recordActivity("work", id, "work.hunt_assessment_changed", {
    newValue: assessment.isRare ? `Rare · ${assessment.huntAssessedOn}` : null,
  });
  invalidate(CACHE_TAGS.works, CACHE_TAGS.activity);
  return assessment;
}

export async function bulkUpdateHuntAssessment(
  workIds: string[],
  input: HuntAssessmentInput,
) {
  const ids = [...new Set(z.array(z.uuid()).min(1).max(1000).parse(workIds))];
  const assessment = huntAssessmentSchema.parse(input);
  // One statement updates the selection atomically. Already-marked books keep
  // their original dates when a mixed selection is marked rare.
  const updated = await db
    .update(works)
    .set({ ...assessment, updatedAt: new Date() })
    .where(and(inArray(works.id, ids), ne(works.isRare, assessment.isRare)))
    .returning({ id: works.id });

  for (const { id } of updated) {
    recordActivity("work", id, "work.hunt_assessment_changed", {
      newValue: assessment.isRare
        ? `Rare · ${assessment.huntAssessedOn}`
        : null,
    });
  }
  invalidate(CACHE_TAGS.works, CACHE_TAGS.activity);
  return { updated: updated.length };
}
