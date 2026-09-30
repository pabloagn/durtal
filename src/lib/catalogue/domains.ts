import { WORK_KINDS, type WorkKind } from "./kinds";

/** Presentation defaults, not a replacement for each domain's page composition. */
interface WorkDomain {
  readonly label: string;
  readonly pluralLabel: string;
  readonly basePath: string;
  readonly enabled: boolean;
  readonly creatorRoles: readonly string[];
  readonly image: {
    readonly slot: "portrait" | "square" | "native";
    readonly fit: "contain";
    readonly emphasis: "standard" | "large";
  };
}

/**
 * New domains stay disabled until their data model, book isolation and complete
 * workflows pass their release gates (SLN-347, SLN-382). Keep the database
 * works_kind_enabled_check in sync through a reviewed activation migration.
 */
export const WORK_DOMAINS = {
  book: {
    label: "Book",
    pluralLabel: "Books",
    basePath: "/library",
    enabled: true,
    creatorRoles: ["author", "co_author"],
    image: { slot: "portrait", fit: "contain", emphasis: "standard" },
  },
  film: {
    label: "Film",
    pluralLabel: "Films",
    basePath: "/films",
    enabled: false,
    creatorRoles: ["director", "screenwriter"],
    image: { slot: "portrait", fit: "contain", emphasis: "standard" },
  },
  perfume: {
    label: "Perfume",
    pluralLabel: "Perfumes",
    basePath: "/perfumes",
    enabled: false,
    creatorRoles: ["perfumer"],
    image: { slot: "square", fit: "contain", emphasis: "standard" },
  },
  painting: {
    label: "Painting",
    pluralLabel: "Paintings",
    basePath: "/paintings",
    enabled: false,
    creatorRoles: ["painter"],
    image: { slot: "native", fit: "contain", emphasis: "large" },
  },
} as const satisfies Record<WorkKind, WorkDomain>;

/** Safe for navigation: never advertise an unfinished domain. */
export function getEnabledWorkKinds(): WorkKind[] {
  return WORK_KINDS.filter((kind) => WORK_DOMAINS[kind].enabled);
}
