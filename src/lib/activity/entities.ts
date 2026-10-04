/**
 * The records that keep an activity history, comments and a gallery layout:
 * works of every collection, people, organizations and venues. Their rows in
 * `activity_events`, `comments` and `gallery_layouts` name one of these as
 * `entity_type`. Older rows keep "work" and "author", which stay valid.
 * Pure module, usable on server and client.
 */
export const ACTIVITY_ENTITY_TYPES = ["work", "author", "organization", "venue"] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

/** The table each type lives in, and its name in harmonization merges and redirects */
export const ENTITY_TABLES: Record<ActivityEntityType, { table: string; merge: string }> = {
  work: { table: "works", merge: "works" },
  author: { table: "authors", merge: "authors" },
  organization: { table: "publishing_houses", merge: "publishers" },
  venue: { table: "venues", merge: "venues" },
};

export function isActivityEntityType(value: unknown): value is ActivityEntityType {
  return (ACTIVITY_ENTITY_TYPES as readonly unknown[]).includes(value);
}
