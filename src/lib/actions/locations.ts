"use server";

import { db } from "@/lib/db";
import { locations, subLocations } from "@/lib/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { atomic } from "@/lib/db/atomic";
import { lockReaderEbooks, withReaderWriteRetry } from "@/lib/reading/reader-write-locks";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";
import {
  createLocationSchema,
  updateLocationSchema,
  createSubLocationSchema,
  updateSubLocationSchema,
  type CreateLocationInput,
  type UpdateLocationInput,
  type CreateSubLocationInput,
  type UpdateSubLocationInput,
} from "@/lib/validations/locations";
import { parseId } from "@/lib/validations/helpers";
import { NO_LOCATION_ITEMS, type LocationItemCounts } from "@/lib/catalogue/location-items";
import { resultRows } from "@/lib/harmonization/store";

export const getLocations = cached(
  () =>
    db.query.locations.findMany({
      // Locations with the same sort order by name, so every list shows one order
      orderBy: [asc(locations.sortOrder), asc(locations.name)],
      with: {
        subLocations: {
          orderBy: asc(subLocations.sortOrder),
        },
      },
    }),
  ["locations"],
  [CACHE_TAGS.locations],
);

/**
 * What each location holds, by kind, keyed by location id; a location with
 * nothing is absent. Read live, never cached: every copy, film, painting and
 * bottle write, move, delete and cascade changes it, and none of them refresh
 * the cached locations (SLN-575).
 */
export async function getLocationItemCounts(): Promise<Map<string, LocationItemCounts>> {
  const rows = resultRows<{ location_id: string; kind: keyof LocationItemCounts; count: number }>(
    await db.execute(sql`
      select location_id, 'copies' as kind, count(*)::int as count from instances group by location_id
      union all
      select location_id, 'films', count(*)::int from film_holdings where location_id is not null group by location_id
      union all
      select location_id, 'paintings', count(*)::int from art_objects where location_id is not null group by location_id
      union all
      select location_id, 'perfumes', count(*)::int from perfume_bottles where location_id is not null group by location_id`),
  );
  const counts = new Map<string, LocationItemCounts>();
  for (const row of rows) {
    const entry = counts.get(row.location_id) ?? { ...NO_LOCATION_ITEMS };
    entry[row.kind] = row.count;
    counts.set(row.location_id, entry);
  }
  return counts;
}

export async function createLocation(input: CreateLocationInput) {
  const [location] = await db
    .insert(locations)
    .values(createLocationSchema.parse(input))
    .returning();
  invalidate(CACHE_TAGS.locations);
  return location;
}

export async function updateLocation(id: string, input: UpdateLocationInput) {
  parseId(id);
  await db
    .update(locations)
    .set(updateLocationSchema.parse(input))
    .where(eq(locations.id, id));
  invalidate(CACHE_TAGS.locations);
  return { id };
}

export async function deleteLocation(id: string) {
  parseId(id);
  await withReaderWriteRetry(() => atomic((d) => [
    lockReaderEbooks(d, sql`select eb.id from ebooks eb join instances i on i.id=eb.instance_id where i.location_id=${id}::uuid`),
    d.delete(locations).where(eq(locations.id, id)),
  ]));
  // The database clears the default location when it is this one
  invalidate(CACHE_TAGS.locations, CACHE_TAGS.settings);
  return { id };
}

export async function createSubLocation(input: CreateSubLocationInput) {
  const [sub] = await db
    .insert(subLocations)
    .values(createSubLocationSchema.parse(input))
    .returning();
  invalidate(CACHE_TAGS.locations);
  return sub;
}

export async function updateSubLocation(
  id: string,
  input: UpdateSubLocationInput,
) {
  parseId(id);
  await db
    .update(subLocations)
    .set(updateSubLocationSchema.parse(input))
    .where(eq(subLocations.id, id));
  invalidate(CACHE_TAGS.locations);
  return { id };
}

export async function deleteSubLocation(id: string) {
  await db.delete(subLocations).where(eq(subLocations.id, id));
  invalidate(CACHE_TAGS.locations);
  return { id };
}
