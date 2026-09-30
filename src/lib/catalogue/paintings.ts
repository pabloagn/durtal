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
