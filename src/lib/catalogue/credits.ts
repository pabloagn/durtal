import type { WorkKind } from "./kinds";

export const ATTRIBUTIONS = [
  "unspecified",
  "confirmed",
  "attributed",
  "uncertain",
  "anonymous",
  "unknown",
] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];
export type CreditLevel = "work" | "edition";

/** Seeded roles are extensible records, scoped by both medium and record level. */
export const CREDIT_ROLES: {
  id: string;
  kind: WorkKind;
  level: CreditLevel;
  label: string;
  legacyRole?: string;
}[] = [
  {
    id: "book.author",
    kind: "book",
    level: "work",
    label: "Author",
    legacyRole: "author",
  },
  {
    id: "book.co_author",
    kind: "book",
    level: "work",
    label: "Co-author",
    legacyRole: "co_author",
  },
  ...[
    "translator",
    "editor",
    "illustrator",
    "foreword",
    "introduction",
    "afterword",
    "photographer",
    "compiler",
    "narrator",
    "contributor",
    "other",
  ].map((role) => ({
    id: `book.edition.${role}`,
    kind: "book" as const,
    level: "edition" as const,
    label: role.charAt(0).toUpperCase() + role.slice(1),
    legacyRole: role,
  })),
  ...[
    "director",
    "screenwriter",
    "story",
    "cast",
    "producer",
    "cinematographer",
    "editor",
    "composer",
    "production_designer",
    "costume_designer",
  ].map((role) => ({
    id: `film.${role}`,
    kind: "film" as const,
    level: "work" as const,
    label:
      role === "cast"
        ? "Cast"
        : role.charAt(0).toUpperCase() + role.slice(1).replaceAll("_", " "),
  })),
  { id: "perfume.perfumer", kind: "perfume", level: "work", label: "Perfumer" },
  {
    id: "perfume.creative_director",
    kind: "perfume",
    level: "work",
    label: "Creative director",
  },
  { id: "painting.painter", kind: "painting", level: "work", label: "Painter" },
];
