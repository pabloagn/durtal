"use server";

import { z } from "zod";
import { and, eq, inArray, ne, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  authors,
  collections,
  publishingHouses,
  recommenders,
  series,
  venues,
  works,
} from "@/lib/db/schema";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";
import { publisherCondition } from "@/lib/catalogue/publisher-boundary";
import {
  FAVOURITE_ENTITIES,
  FAVOURITE_ENTITY_LABELS,
  type FavouriteEntity,
} from "@/lib/constants/favourites";

/**
 * The favourite flag of each item type: one boolean column per table.
 * Places keep their US spelling (`venues.is_favorite`). Publishers and
 * organizations share `publishing_houses.is_favourite`: the publisher paths
 * keep to houses with a publisher kind, an organization may be any house.
 */
const TARGETS = {
  work: { column: works.isFavourite, id: works.id, tags: [CACHE_TAGS.works] },
  author: { column: authors.isFavourite, id: authors.id, tags: [CACHE_TAGS.authors] },
  collection: { column: collections.isFavourite, id: collections.id, tags: [CACHE_TAGS.collections] },
  series: { column: series.isFavourite, id: series.id, tags: [CACHE_TAGS.series, CACHE_TAGS.works] },
  recommender: { column: recommenders.isFavourite, id: recommenders.id, tags: [CACHE_TAGS.recommenders] },
  venue: { column: venues.isFavorite, id: venues.id, tags: [CACHE_TAGS.venues, CACHE_TAGS.places, CACHE_TAGS.orders] },
  publisher: { column: publishingHouses.isFavourite, id: publishingHouses.id, scope: publisherCondition, tags: [CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.orders] },
  organization: { column: publishingHouses.isFavourite, id: publishingHouses.id, tags: [CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.orders] },
} as const;

function scopeOf(entity: FavouriteEntity): SQL | undefined {
  const target = TARGETS[entity];
  return "scope" in target ? target.scope : undefined;
}

/** Writes the flag on the rows that differ; returns their ids */
function write(entity: FavouriteEntity, where: SQL, favourite: boolean) {
  const now = new Date();
  switch (entity) {
    case "work":
      return db.update(works).set({ isFavourite: favourite, updatedAt: now }).where(where).returning({ id: works.id });
    case "author":
      return db.update(authors).set({ isFavourite: favourite, updatedAt: now }).where(where).returning({ id: authors.id });
    case "collection":
      return db.update(collections).set({ isFavourite: favourite, updatedAt: now }).where(where).returning({ id: collections.id });
    case "series":
      return db.update(series).set({ isFavourite: favourite, updatedAt: now }).where(where).returning({ id: series.id });
    case "recommender":
      return db.update(recommenders).set({ isFavourite: favourite, updatedAt: now }).where(where).returning({ id: recommenders.id });
    case "venue":
      return db.update(venues).set({ isFavorite: favourite, updatedAt: now }).where(where).returning({ id: venues.id });
    case "publisher":
    case "organization":
      return db.update(publishingHouses).set({ isFavourite: favourite }).where(where).returning({ id: publishingHouses.id });
  }
}

const favouriteInputSchema = z.object({
  entity: z.enum(FAVOURITE_ENTITIES),
  ids: z.array(z.uuid()).min(1).max(1000),
  favourite: z.boolean(),
});

/** Item types whose activity log shows the change */
const ACTIVITY: Partial<Record<FavouriteEntity, "work" | "author">> = {
  work: "work",
  author: "author",
};

/**
 * Stars or unstars items of one type. Only rows that change are written and
 * logged; the result counts them.
 */
export async function setFavourites(input: {
  entity: FavouriteEntity;
  ids: string[];
  favourite: boolean;
}) {
  const { entity, ids, favourite } = favouriteInputSchema.parse(input);
  const target = TARGETS[entity];
  const unique = [...new Set(ids)];
  const updated = await write(
    entity,
    and(inArray(target.id, unique), ne(target.column, favourite), scopeOf(entity))!,
    favourite,
  );
  const activityType = ACTIVITY[entity];
  if (activityType) {
    for (const { id } of updated) {
      recordActivity(activityType, id, `${activityType}.favourite_changed`, {
        newValue: favourite ? "favourite" : null,
      });
    }
  }
  invalidate(...target.tags, ...(activityType ? [CACHE_TAGS.activity] : []));
  return { updated: updated.length };
}

/** Stars or unstars one item; throws when there is no such item */
export async function setFavourite(
  entity: FavouriteEntity,
  id: string,
  favourite: boolean,
) {
  const result = await setFavourites({ entity, ids: [id], favourite });
  if (result.updated === 0) {
    // Already in the wanted state, or no such item: writing the same value
    // again tells them apart
    const target = TARGETS[entity];
    const found = await write(
      entity,
      and(eq(target.id, id), scopeOf(entity))!,
      favourite,
    );
    if (!found.length) throw new Error(`${FAVOURITE_ENTITY_LABELS[entity]} not found`);
  }
  return result;
}
