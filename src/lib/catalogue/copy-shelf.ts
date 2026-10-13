import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { subLocations } from "@/lib/db/schema";

/** Where a book copy sits: a location and, optionally, a sub-location in it */
export interface CopyPlace {
  locationId: string;
  subLocationId?: string | null;
}

/**
 * A book copy's sub-location must belong to its location, or the copy would
 * be in two places at once (SLN-574). Every copy writer checks first and gets
 * the reason back, or null when every sub-location fits. Sub-locations never
 * move between locations (`updateSubLocationSchema` omits `locationId`), so
 * the check cannot go stale before the write.
 */
export async function copyShelfMismatch(
  places: readonly CopyPlace[],
  conn: Pick<typeof db, "select"> = db,
): Promise<string | null> {
  const ids = [...new Set(places.flatMap((p) => (p.subLocationId ? [p.subLocationId] : [])))];
  if (!ids.length) return null;
  const rows = await conn
    .select({ id: subLocations.id, locationId: subLocations.locationId })
    .from(subLocations)
    .where(inArray(subLocations.id, ids));
  const parent = new Map(rows.map((row) => [row.id, row.locationId]));
  for (const { locationId, subLocationId } of places) {
    if (!subLocationId) continue;
    // One that is gone is left to the foreign key, which refuses the write
    const owner = parent.get(subLocationId);
    if (owner && owner !== locationId) return "The sub-location belongs to another location";
  }
  return null;
}
