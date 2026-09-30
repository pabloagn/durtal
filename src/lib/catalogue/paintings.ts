/**
 * An original, an identified version by the artist or workshop, or a
 * reproduction (print, copy, poster). A reproduction never replaces the
 * original it reproduces.
 */
export const ART_OBJECT_KINDS = ["original", "version", "reproduction"] as const;
export const ART_OBJECT_KIND_LABELS: Record<
  (typeof ART_OBJECT_KINDS)[number],
  string
> = {
  original: "Original",
  version: "Version",
  reproduction: "Reproduction",
};
/**
 * Who owns the object. Institutional ownership names an organization;
 * personal ownership is the collector's own holding. Custody and physical
 * location are recorded separately.
 */
export const ART_OWNERSHIPS = [
  "institutional",
  "private",
  "personal",
  "unknown",
] as const;
export const DIMENSION_UNITS = ["mm", "cm", "in"] as const;
export const CENTIMETRES_PER_UNIT: Record<
  (typeof DIMENSION_UNITS)[number],
  number
> = { mm: 0.1, cm: 1, in: 2.54 };
/** 1 km in any unit is an input error, not a painting. */
export const MAX_DIMENSION = 100000;

/** Where an object is: a venue, an unnamed private place, or unknown, lost or destroyed. */
export const WHEREABOUTS_PLACES = [
  "venue",
  "private",
  "unknown",
  "lost",
  "destroyed",
] as const;
/** Why the object is there. Loans and permanent collections are at a venue. */
export const WHEREABOUTS_CUSTODY = [
  "permanent_collection",
  "temporary_loan",
  "long_term_loan",
  "private",
  "unknown",
] as const;
/** Stated separately: holding an object never means it is shown. */
export const DISPLAY_STATUSES = ["on_display", "in_storage", "unknown"] as const;
/**
 * Confirmed records form one non-overlapping history per object. Probable and
 * uncertain claims may overlap it and each other; they are kept, not merged.
 */
export const WHEREABOUTS_CERTAINTY = ["confirmed", "probable", "uncertain"] as const;
/** A current location unchecked for longer than this is flagged as stale. */
export const WHEREABOUTS_STALE_DAYS = 365;
