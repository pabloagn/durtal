import { db } from "@/lib/db";
import { activityEvents } from "@/lib/db/schema";
import type { ActivityMetadata } from "./types";
import type { ActivityEntityType } from "./entities";

/** The writes started and not yet landed */
const pending = new Set<Promise<void>>();

/**
 * Fire-and-forget activity event recording.
 * Never blocks or breaks the calling mutation.
 */
export function recordActivity(
  entityType: ActivityEntityType,
  entityId: string,
  eventKey: string,
  metadata?: ActivityMetadata,
): void {
  const write = db
    .insert(activityEvents)
    .values({
      entityType,
      entityId,
      eventKey,
      metadata: metadata ?? null,
    })
    .then(() => {})
    .catch((err) => {
      console.error("[activity] Failed to record event:", eventKey, err);
    })
    .finally(() => pending.delete(write));
  pending.add(write);
}

/**
 * Resolves once every activity write started so far has landed. A merge's
 * fingerprint covers the works' activity events, so a test that merges right
 * after an action waits for this between the preview and its own writes
 * (SLN-521).
 */
export async function activitySettled(): Promise<void> {
  await Promise.all([...pending]);
}
