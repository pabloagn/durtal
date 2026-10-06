import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";

export interface NavSection {
  href: string;
  label: string;
}

/** The home of each open collection (Books, Perfumes...), never an unready one. */
export const DOMAIN_SECTIONS: NavSection[] = getEnabledWorkKinds().map(
  (kind) => ({
    href: WORK_DOMAINS[kind].basePath,
    label: WORK_DOMAINS[kind].pluralLabel,
  }),
);

/** Every section in sidebar order: the sidebar and the command palette list these. */
export const NAV_SECTIONS: NavSection[] = [
  { href: "/", label: "Dashboard" },
  ...DOMAIN_SECTIONS,
  { href: "/reading", label: "Reading" },
  { href: "/people", label: "People" },
  { href: "/publishers", label: "Publishers" },
  { href: "/organizations", label: "Organizations" },
  { href: "/recommenders", label: "Recommenders" },
  { href: "/series", label: "Series" },
  { href: "/places", label: "Places" },
  { href: "/provenance", label: "Provenance" },
  { href: "/locations", label: "Locations" },
  { href: "/collections", label: "Collections" },
  { href: "/taxonomy", label: "Taxonomy" },
  { href: "/harmonize", label: "Harmonize" },
  { href: "/settings", label: "Settings" },
];

/** The section a path belongs to: "/" only for itself, others for their subpaths too. */
export function isSectionActive(href: string, pathname: string) {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}
