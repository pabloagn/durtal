import { WORK_KINDS, type WorkKind } from "./kinds";
import { WORK_DOMAINS } from "./domains";

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

/** Every valid place a family can apply to, in a stable display order. */
export const TAXONOMY_SCOPE_OPTIONS = WORK_KINDS.flatMap((kind) =>
  TAXONOMY_LEVELS.filter((level) => validTaxonomyScope(kind, level)).map(
    (level) => ({ kind, level }),
  ),
);
/** "Books", "Book editions", "Perfume formulations" and so on. */
export function taxonomyScopeLabel(kind: WorkKind, level: TaxonomyLevel) {
  switch (level) {
    case "work":
      return WORK_DOMAINS[kind].pluralLabel;
    case "edition":
      return "Book editions";
    case "perfume_variant":
      return "Perfume formulations";
    case "film_version":
      return "Film versions";
    case "art_object":
      return "Art objects";
  }
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
