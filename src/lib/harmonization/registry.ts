/** Domain capabilities, shared by scan and review UI. No names or IDs are special-cased. */
export interface EntityDefinition {
  key: string;
  label: string;
  table: string;
  name: string;
  route: string;
  duplicate?: boolean;
  fuzzy?: boolean;
  merge?: boolean;
  person?: boolean;
  scope?: string[];
  mediaOwner?: string;
  artwork?: string[];
}
const taxonomy = (key: string, table: string): EntityDefinition => ({
  key,
  table,
  label: "Taxonomy",
  name: "name",
  route: `/taxonomy/${key}`,
  duplicate: true,
  merge: true,
  scope: ["parent_id"],
});
export const ENTITIES: EntityDefinition[] = [
  {
    key: "works",
    table: "works",
    label: "Books",
    name: "title",
    route: "/library",
    duplicate: true,
    fuzzy: true,
    merge: true,
    mediaOwner: "work_id",
    artwork: ["poster"],
  },
  {
    key: "authors",
    table: "authors",
    label: "Authors",
    name: "name",
    route: "/authors",
    duplicate: true,
    fuzzy: true,
    merge: true,
    person: true,
    mediaOwner: "author_id",
    artwork: ["poster", "background"],
  },
  {
    key: "editions",
    table: "editions",
    label: "Editions",
    name: "title",
    route: "/library",
    duplicate: true,
    fuzzy: true,
    scope: ["work_id", "language", "binding", "publication_year"],
  },
  {
    key: "publishers",
    table: "publishing_houses",
    label: "Publishers",
    name: "name",
    route: "/publishers",
    duplicate: true,
    fuzzy: true,
    merge: true,
    scope: ["kind", "parent_id", "country_id"],
  },
  {
    key: "recommenders",
    table: "recommenders",
    label: "Recommenders",
    name: "name",
    route: "/recommenders",
    duplicate: true,
    fuzzy: true,
    merge: true,
  },
  {
    key: "series",
    table: "series",
    label: "Series",
    name: "title",
    route: "/series",
    duplicate: true,
    fuzzy: true,
    merge: true,
  },
  {
    key: "venues",
    table: "venues",
    label: "Places",
    name: "name",
    route: "/places",
    duplicate: true,
    fuzzy: true,
    merge: true,
    scope: ["type", "place_id", "formatted_address"],
  },
  {
    key: "places",
    table: "places",
    label: "Geography",
    name: "name",
    route: "/authors?view=map",
    duplicate: true,
    fuzzy: true,
    merge: true,
    scope: ["type", "country_id", "parent_id"],
  },
  {
    key: "locations",
    table: "locations",
    label: "Locations",
    name: "name",
    route: "/locations",
    duplicate: true,
    fuzzy: true,
    merge: true,
    scope: ["type", "country", "city", "street"],
  },
  {
    key: "sub-locations",
    table: "sub_locations",
    label: "Shelves",
    name: "name",
    route: "/locations",
    duplicate: true,
    fuzzy: true,
    merge: true,
    scope: ["location_id"],
  },
  {
    key: "collections",
    table: "collections",
    label: "Collections",
    name: "name",
    route: "/collections",
    duplicate: true,
    fuzzy: true,
    merge: true,
    mediaOwner: "collection_id",
    artwork: ["poster", "background"],
  },
  {
    key: "orders",
    table: "orders",
    label: "Provenance",
    name: "order_confirmation",
    route: "/provenance",
  },
  {
    key: "instances",
    table: "instances",
    label: "Copies",
    name: "format",
    route: "/library",
  },
  {
    key: "sources",
    table: "sources",
    label: "Sources",
    name: "name",
    route: "/settings",
    duplicate: true,
    merge: true,
  },
  taxonomy("subjects", "subjects"),
  taxonomy("genres", "genres"),
  taxonomy("tags", "tags"),
  taxonomy("categories", "book_categories"),
  taxonomy("themes", "themes"),
  taxonomy("literary-movements", "literary_movements"),
  taxonomy("art-types", "art_types"),
  taxonomy("art-movements", "art_movements"),
  taxonomy("keywords", "keywords"),
  taxonomy("attributes", "attributes"),
  {
    ...taxonomy("custom-taxonomy", "custom_taxonomy_items"),
    scope: ["family_id", "parent_id"],
  },
  { ...taxonomy("work-types", "work_types"), merge: false },
  { ...taxonomy("contribution-types", "contribution_types"), merge: false },
];
export function entityDefinition(key: string) {
  const entity = ENTITIES.find((item) => item.key === key);
  if (!entity) throw new Error("Unknown catalogue entity");
  return entity;
}
export const CATEGORY_LABELS = {
  duplicates: "Duplicates",
  artwork: "Artwork",
  metadata: "Metadata",
  integrity: "Integrity",
} as const;
export function fieldLabel(key: string) {
  return key
    .replace(/_s3_key$/, " image")
    .replace(/_id$/, " reference")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}
