export const ORGANIZATION_ROLES = [
  "publisher",
  "imprint",
  "perfume_house",
  "brand",
  "manufacturer",
  "retailer",
  "production_company",
  "distribution_company",
  "museum",
  "gallery",
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
export const NON_PUBLISHING_ROLES = [
  "perfume_house",
  "brand",
  "manufacturer",
  "retailer",
  "production_company",
  "distribution_company",
  "museum",
  "gallery",
] as const;

/**
 * The roles the shared directory lists: a publishing group (a book profile
 * level, kept on the publisher record) and every organization role.
 */
export const DIRECTORY_ROLES = ["group", ...ORGANIZATION_ROLES] as const;
export type DirectoryRole = (typeof DIRECTORY_ROLES)[number];
/** The book profile levels, kept on the publisher record itself */
export const PUBLISHING_LEVELS = ["group", "publisher", "imprint"] as const;

/**
 * How each role reads in the shared directory and on an organization's page:
 * the words of its collection ("Perfume house", "Museum"), not "publisher".
 */
export const ORGANIZATION_ROLE_LABELS: Record<
  DirectoryRole,
  { one: string; many: string }
> = {
  group: { one: "Publishing group", many: "Publishing groups" },
  publisher: { one: "Publisher", many: "Publishers" },
  imprint: { one: "Imprint", many: "Imprints" },
  perfume_house: { one: "Perfume house", many: "Perfume houses" },
  brand: { one: "Brand", many: "Brands" },
  manufacturer: { one: "Manufacturer", many: "Manufacturers" },
  retailer: { one: "Retailer", many: "Retailers" },
  production_company: { one: "Production company", many: "Production companies" },
  distribution_company: { one: "Distributor", many: "Distributors" },
  museum: { one: "Museum", many: "Museums" },
  gallery: { one: "Gallery", many: "Galleries" },
};

/** "Perfume house · Retailer": an organization's roles, in the directory's order */
export function organizationRoleText(roles: readonly string[]) {
  return DIRECTORY_ROLES.filter((role) => roles.includes(role))
    .map((role) => ORGANIZATION_ROLE_LABELS[role].one)
    .join(" · ");
}

/** Counts on a directory row stop here: a row shows "999+" past it */
export const COUNT_CAP = 999;

/** A count on a directory row: exact up to the cap, then "999+" */
export function boundedCount(n: number) {
  return n > COUNT_CAP ? `${COUNT_CAP}+` : String(n);
}

/** What an organization takes part in, per collection, as a directory row counts it */
export interface ContributionCounts {
  editions: number;
  perfumes: number;
  films: number;
  paintings: number;
  venues: number;
}

const NOUNS: Record<keyof ContributionCounts, [string, string]> = {
  editions: ["edition", "editions"],
  perfumes: ["perfume", "perfumes"],
  films: ["film", "films"],
  paintings: ["painting", "paintings"],
  venues: ["venue", "venues"],
};

/** "124 editions · 3 films": what an organization takes part in, bounded */
export function contributionText(counts: ContributionCounts) {
  return (Object.keys(NOUNS) as (keyof ContributionCounts)[])
    .filter((key) => counts[key] > 0)
    .map((key) => `${boundedCount(counts[key])} ${NOUNS[key][counts[key] === 1 ? 0 : 1]}`)
    .join(" · ");
}
