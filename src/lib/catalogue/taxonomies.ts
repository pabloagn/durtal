import type { WorkKind } from "./kinds";

export const TAXONOMY_LEVELS = [
  "work",
  "edition",
  "perfume_variant",
  "film_version",
  "art_object",
] as const;
export type TaxonomyLevel = (typeof TAXONOMY_LEVELS)[number];
export function validTaxonomyScope(kind: WorkKind, level: TaxonomyLevel) {
  return (
    level === "work" ||
    (kind === "book" && level === "edition") ||
    (kind === "perfume" && level === "perfume_variant") ||
    (kind === "film" && level === "film_version") ||
    (kind === "painting" && level === "art_object")
  );
}

export const DOMAIN_TAXONOMIES = [
  {
    slug: "film-genres",
    name: "Film genres",
    kind: "film",
    levels: ["work"],
    hierarchical: true,
  },
  {
    slug: "perfume-families",
    name: "Perfume families",
    kind: "perfume",
    levels: ["work", "perfume_variant"],
    hierarchical: true,
  },
  {
    slug: "perfume-accords",
    name: "Perfume accords",
    kind: "perfume",
    levels: ["work", "perfume_variant"],
    hierarchical: false,
  },
  {
    slug: "perfume-notes",
    name: "Perfume notes",
    kind: "perfume",
    levels: ["work", "perfume_variant"],
    hierarchical: true,
  },
  {
    slug: "painting-genres",
    name: "Painting genres",
    kind: "painting",
    levels: ["work"],
    hierarchical: true,
  },
  {
    slug: "painting-techniques",
    name: "Painting techniques",
    kind: "painting",
    levels: ["work", "art_object"],
    hierarchical: true,
  },
  {
    slug: "painting-media",
    name: "Painting media",
    kind: "painting",
    levels: ["work", "art_object"],
    hierarchical: true,
  },
  {
    slug: "painting-supports",
    name: "Painting supports",
    kind: "painting",
    levels: ["work", "art_object"],
    hierarchical: true,
  },
] as const satisfies readonly {
  slug: string;
  name: string;
  kind: WorkKind;
  levels: readonly TaxonomyLevel[];
  hierarchical: boolean;
}[];
