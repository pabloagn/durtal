"use server";

import { db } from "@/lib/db";
import { places } from "@/lib/db/schema";
import { eq, ilike, and, isNull } from "drizzle-orm";

type PlaceRow = typeof places.$inferSelect;

export async function createPlace(input: {
  name: string;
  type: string;
  fullName?: string | null;
  parentId?: string | null;
  countryId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geonameId?: number | null;
  wikidataId?: string | null;
}) {
  const [place] = await db.insert(places).values(input).returning();
  return place;
}

export async function searchPlaces(query: string, limit = 20) {
  return db.query.places.findMany({
    where: ilike(places.name, `%${query}%`),
    limit,
    with: {
      country: { columns: { name: true, alpha2: true } },
      parent: { columns: { name: true, type: true } },
    },
  });
}

/**
 * Return the full parent chain for a place, from the given place up to the root.
 * Returns an array ordered from the place itself to the top-most ancestor.
 */
export async function getPlaceHierarchy(id: string): Promise<PlaceRow[]> {
  const chain: PlaceRow[] = [];

  let currentId: string | null = id;
  while (currentId) {
    const rows: PlaceRow[] = await db
      .select()
      .from(places)
      .where(eq(places.id, currentId))
      .limit(1);
    const place = rows[0];
    if (!place) break;
    chain.push(place);
    currentId = place.parentId;
  }

  return chain;
}

/**
 * Given an ordered chain from most-specific to least-specific
 * (e.g. [{name:"Paris", type:"city"}, {name:"France", type:"country"}]),
 * find or create each place and link the hierarchy.
 * Returns the most-specific (first) place.
 */
export async function getOrCreatePlaceChain(
  chain: { name: string; type: string }[],
): Promise<PlaceRow | null> {
  if (chain.length === 0) return null;

  // Process from least-specific (last) to most-specific (first)
  let parentId: string | null = null;

  for (let i = chain.length - 1; i >= 0; i--) {
    const { name, type } = chain[i];

    // Try to find an existing place with matching name, type, and parent
    const existingRows: PlaceRow[] = await db
      .select()
      .from(places)
      .where(
        parentId
          ? and(
              ilike(places.name, name),
              eq(places.type, type),
              eq(places.parentId, parentId),
            )
          : and(
              ilike(places.name, name),
              eq(places.type, type),
              isNull(places.parentId),
            ),
      )
      .limit(1);

    const existing = existingRows[0];

    if (existing) {
      parentId = existing.id;
    } else {
      const inserted: PlaceRow[] = await db
        .insert(places)
        .values({ name, type, parentId })
        .returning();
      parentId = inserted[0].id;
    }
  }

  // parentId now points to the most-specific place (first in the chain)
  const resultRows: PlaceRow[] = await db
    .select()
    .from(places)
    .where(eq(places.id, parentId!))
    .limit(1);

  return resultRows[0] ?? null;
}
