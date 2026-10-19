"use server";

import { db } from "@/lib/db";
import { locations, subLocations } from "@/lib/db/schema";
import { eq, asc, sql, type SQL } from "drizzle-orm";
import { atomic } from "@/lib/db/atomic";
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
import {
  describeLocationItems,
  locationItemTotal,
  NO_LOCATION_ITEMS,
  type LocationItemCounts,
} from "@/lib/catalogue/location-items";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { ExpectedActionError } from "./expected-error";

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
  return locationItemCounts(sql`location_id is not null`);
}

async function locationItemCounts(where: SQL): Promise<Map<string, LocationItemCounts>> {
  const rows = resultRows<{ location_id: string; kind: keyof LocationItemCounts; count: number }>(
    await db.execute(sql`
      select location_id, 'copies' as kind, count(*)::int as count from instances where ${where} group by location_id
      union all
      select location_id, 'films', count(*)::int from film_holdings where ${where} group by location_id
      union all
      select location_id, 'paintings', count(*)::int from art_objects where ${where} group by location_id
      union all
      select location_id, 'perfumes', count(*)::int from perfume_bottles where ${where} group by location_id`),
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

/**
 * Deletes an empty location. One that still holds anything, book copies
 * included, is refused with what to move first: a copy is never deleted with
 * the place it sits in (SLN-1060)
 */
export async function deleteLocation(id: string) {
  parseId(id);
  const [location] = await db
    .select({ name: locations.name })
    .from(locations)
    .where(eq(locations.id, id));
  if (!location) return { id };
  const held = (await locationItemCounts(sql`location_id=${id}::uuid`)).get(id);
  if (held && locationItemTotal(held) > 0)
    throw new ExpectedActionError(
      `${location.name} holds ${describeLocationItems(held)}. Move ${locationItemTotal(held) === 1 ? "it" : "them"} to another location first.`,
    );
  await atomic((d) => [
    // A copy, film, painting or bottle saved here meanwhile waits on this lock
    // and then fails its reference check, or is seen by the check below
    d.execute(sql`select id from locations where id=${id}::uuid for update`),
    d.execute(
      assertSql(
        sql`not exists (select 1 from instances where location_id=${id}::uuid)
          and not exists (select 1 from film_holdings where location_id=${id}::uuid)
          and not exists (select 1 from art_objects where location_id=${id}::uuid)
          and not exists (select 1 from perfume_bottles where location_id=${id}::uuid)`,
        `${location.name} holds items now. Move them to another location first.`,
      ),
    ),
    d.delete(locations).where(eq(locations.id, id)),
  ]);
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
