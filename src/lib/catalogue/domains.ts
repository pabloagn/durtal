import { WORK_KINDS, type WorkKind } from "./kinds";

export const WORK_CAPABILITIES = [
  "curation",
  "personalHoldings",
  "bookLifecycle",
  "bookEditions",
  "reading",
  "perfumeVariants",
  "filmVersions",
  "artObjects",
  "originalWhereabouts",
] as const;
export type WorkCapability = (typeof WORK_CAPABILITIES)[number];

/** Presentation defaults, not a replacement for each domain's page composition. */
interface WorkDomain {
  readonly label: string;
  readonly pluralLabel: string;
  readonly basePath: string;
  /** Keys after G (go to its home) and after A (add one); unique per menu */
  readonly keys: { readonly go: string; readonly add: string };
  readonly capabilities: Readonly<Record<WorkCapability, boolean>>;
  readonly creatorRoles: readonly string[];
  readonly image: {
    readonly slot: "portrait" | "square" | "native";
    readonly fit: "contain";
    readonly emphasis: "standard" | "large";
  };
}

/**
 * The four collections, all open since migration 0055 (SLN-347, SLN-382). A
 * new kind needs its own reviewed migration of works_kind_enabled_check.
 */
export const WORK_DOMAINS = {
  book: {
    label: "Book",
    pluralLabel: "Books",
    basePath: "/library",
    keys: { go: "b", add: "b" },
    capabilities: {
      curation: true,
      personalHoldings: true,
      bookLifecycle: true,
      bookEditions: true,
      reading: true,
      perfumeVariants: false,
      filmVersions: false,
      artObjects: false,
      originalWhereabouts: false,
    },
    creatorRoles: ["author", "co_author"],
    image: { slot: "portrait", fit: "contain", emphasis: "standard" },
  },
  film: {
    label: "Film",
    pluralLabel: "Films",
    basePath: "/films",
    keys: { go: "f", add: "f" },
    capabilities: {
      curation: true,
      personalHoldings: true,
      bookLifecycle: false,
      bookEditions: false,
      reading: false,
      perfumeVariants: false,
      filmVersions: true,
      artObjects: false,
      originalWhereabouts: false,
    },
    creatorRoles: ["director", "screenwriter"],
    image: { slot: "portrait", fit: "contain", emphasis: "standard" },
  },
  perfume: {
    label: "Perfume",
    pluralLabel: "Perfumes",
    basePath: "/perfumes",
    keys: { go: "e", add: "p" },
    capabilities: {
      curation: true,
      personalHoldings: true,
      bookLifecycle: false,
      bookEditions: false,
      reading: false,
      perfumeVariants: true,
      filmVersions: false,
      artObjects: false,
      originalWhereabouts: false,
    },
    creatorRoles: ["perfumer"],
    image: { slot: "square", fit: "contain", emphasis: "standard" },
  },
  painting: {
    label: "Painting",
    pluralLabel: "Paintings",
    basePath: "/paintings",
    keys: { go: "i", add: "i" },
    capabilities: {
      curation: true,
      personalHoldings: true,
      bookLifecycle: false,
      bookEditions: false,
      reading: false,
      perfumeVariants: false,
      filmVersions: false,
      artObjects: true,
      originalWhereabouts: true,
    },
    creatorRoles: ["painter"],
    image: { slot: "native", fit: "contain", emphasis: "large" },
  },
} as const satisfies Record<WorkKind, WorkDomain>;

/** The order collections are listed in: navigation, menus and the dashboard. */
export const DOMAIN_ORDER = [
  "book",
  "perfume",
  "film",
  "painting",
] as const satisfies readonly WorkKind[];

/** Structural support is distinct from rollout readiness. */
export function kindsWithCapability(capability: WorkCapability): WorkKind[] {
  return WORK_KINDS.filter(
    (kind) => WORK_DOMAINS[kind].capabilities[capability],
  );
}
export function canUseWorkCapability(
  kind: WorkKind,
  capability: WorkCapability,
) {
  return WORK_DOMAINS[kind].capabilities[capability];
}
