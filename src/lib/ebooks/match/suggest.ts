import "server-only";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { databaseFingerprint } from "../ingest/command";
import { planSuggestionsForWorkOn, persistWorkSuggestions, type WorkSuggestionOutcome } from "./work-suggestions";
export { planSuggestionsForWorkOn, persistWorkSuggestions, WORK_SUGGESTION_BOUNDS } from "./work-suggestions";
export type { WorkSuggestionPlan, WorkSuggestionOutcome } from "./work-suggestions";

/** Call after the book creation has committed. A missing/unavailable matching
 * database or stale plan cannot turn the successfully created book into failure. */
export async function suggestForNewWork(workId: string): Promise<WorkSuggestionOutcome> {
  try {
    const url = serverEnv().DATABASE_URL;
    const target = databaseFingerprint(url);
    const plan = await withReadOnlyPlanningConnection(url,
      (conn) => planSuggestionsForWorkOn(conn, workId, { targetDatabase: target }),
      { isolationLevel: "repeatable read" });
    const result = await persistWorkSuggestions(db, plan, target);
    invalidate(CACHE_TAGS.works);
    return result;
  } catch {
    return { workId, suggestionCount: 0, status: "unavailable" };
  }
}
