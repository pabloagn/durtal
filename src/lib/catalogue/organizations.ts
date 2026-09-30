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
