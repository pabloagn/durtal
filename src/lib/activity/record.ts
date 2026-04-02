import { db } from "@/lib/db";
import { activityEvents } from "@/lib/db/schema";
import type { ActivityMetadata } from "./types";

/**
 * Fire-and-forget activity event recording.
 * Never blocks or breaks the calling mutation.
 */
export function recordActivity(
  entityType: "work" | "author",
  entityId: string,
  eventKey: string,
  metadata?: ActivityMetadata,
): void {
  db.insert(activityEvents)
    .values({
      entityType,
      entityId,
      eventKey,
      metadata: metadata ?? null,
    })
    .then(() => {})
    .catch((err) => {
      console.error("[activity] Failed to record event:", eventKey, err);
    });
}
