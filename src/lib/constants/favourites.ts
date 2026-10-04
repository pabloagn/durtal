/**
 * The item types that can be starred as a favourite. Publishers and
 * organizations share the `publishing_houses` table and its flag.
 */
export const FAVOURITE_ENTITIES = [
  "work",
  "author",
  "collection",
  "series",
  "recommender",
  "venue",
  "publisher",
  "organization",
] as const;

export type FavouriteEntity = (typeof FAVOURITE_ENTITIES)[number];

/** One item of each type, in messages: "Publisher not found" */
export const FAVOURITE_ENTITY_LABELS: Record<FavouriteEntity, string> = {
  work: "Work",
  author: "Person",
  collection: "Collection",
  series: "Series",
  recommender: "Recommender",
  venue: "Place",
  publisher: "Publisher",
  organization: "Organization",
};

/** URL parameter of the "Favourites only" filter on every list page */
export const FAVOURITES_PARAM = "favourites";

/** True when a list's URL asks for favourites only */
export function favouritesOnly(value: string | string[] | null | undefined) {
  return (Array.isArray(value) ? value[0] : value) === "true";
}

/** The "Favourites" group of a list's filter menu, in one style everywhere */
export const FAVOURITES_FILTER_GROUP = {
  key: FAVOURITES_PARAM,
  label: "Favourites",
  options: [{ value: "true", label: "Favourites only" }],
};
