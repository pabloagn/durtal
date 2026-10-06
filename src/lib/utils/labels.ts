/**
 * Readable labels for stored keys (SLN-400): catalogue status, priority,
 * metadata source and other enum values. Use these wherever a stored key
 * shows as text. Languages: `languageName` (`@/lib/utils/language`).
 * Bindings: `bindingLabel` (`@/lib/utils/binding`). Pure module.
 */
import { STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/constants/catalogue";
import type { CatalogueStatus, AcquisitionPriority } from "@/lib/types";

/** Keys whose label is not their words in sentence case */
const SPECIAL_LABELS: Record<string, string> = {
  ebook: "eBook",
  pdf: "PDF",
  epub: "EPUB",
};

/** "lent_out" → "Lent out", "ebook" → "eBook" */
export function enumLabel(value: string | null | undefined): string {
  if (!value) return "";
  if (SPECIAL_LABELS[value]) return SPECIAL_LABELS[value];
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "on_order" → "On Order", from the status config */
export function catalogueStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return STATUS_CONFIG[status as CatalogueStatus]?.label ?? enumLabel(status);
}

/** "high" → "High", from the priority config */
export function priorityLabel(priority: string | null | undefined): string {
  if (!priority) return "";
  return (
    PRIORITY_CONFIG[priority as AcquisitionPriority]?.label ?? enumLabel(priority)
  );
}

const SOURCE_LABELS: Record<string, string> = {
  isbndb: "ISBNdb",
  google_books: "Google Books",
  open_library: "Open Library",
  wikidata: "Wikidata",
  wikipedia: "Wikipedia",
  phantom_canon: "Phantom Canon",
  manual: "Manual entry",
};

/** "isbndb" → "ISBNdb" */
export function metadataSourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  return SOURCE_LABELS[source] ?? enumLabel(source);
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  } catch {
    return null;
  }
})();

/**
 * Short country name for display: the English name of the ISO code
 * ("GB" → "United Kingdom"), else the official name before its comma
 * ("Argentina, Argentine Republic" → "Argentina").
 */
export function countryDisplayName(
  country: { name: string; alpha2?: string | null } | null | undefined,
): string | null {
  if (!country) return null;
  if (country.alpha2) {
    try {
      const name = regionNames?.of(country.alpha2.toUpperCase());
      if (name) return name;
    } catch {
      // Not a valid region code
    }
  }
  return country.name.split(",")[0].trim();
}
