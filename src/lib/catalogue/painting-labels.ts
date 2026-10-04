import {
  ART_OBJECT_KIND_LABELS,
  type ART_OBJECT_KINDS,
  type ART_OWNERSHIPS,
  type DIMENSION_UNITS,
  type DISPLAY_STATUSES,
  type WHEREABOUTS_CERTAINTY,
  type WHEREABOUTS_CUSTODY,
  type WHEREABOUTS_PLACES,
} from "./paintings";
import type { Attribution } from "./credits";
import { appTimeZone } from "@/lib/utils/date";

export type ArtObjectKind = (typeof ART_OBJECT_KINDS)[number];
export type ArtOwnership = (typeof ART_OWNERSHIPS)[number];
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];
export type WhereaboutsPlace = (typeof WHEREABOUTS_PLACES)[number];
export type WhereaboutsCustody = (typeof WHEREABOUTS_CUSTODY)[number];
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];
export type WhereaboutsCertainty = (typeof WHEREABOUTS_CERTAINTY)[number];

export { ART_OBJECT_KIND_LABELS };

export const OWNERSHIP_LABELS: Record<ArtOwnership, string> = {
  institutional: "A museum or institution",
  private: "A private collection",
  personal: "Me",
  unknown: "Unknown",
};

export const PLACE_LABELS: Record<WhereaboutsPlace, string> = {
  venue: "At a museum or gallery",
  private: "In a private place",
  unknown: "Unknown",
  lost: "Lost",
  destroyed: "Destroyed",
};

export const CUSTODY_LABELS: Record<WhereaboutsCustody, string> = {
  permanent_collection: "Permanent collection",
  temporary_loan: "On loan for an exhibition",
  long_term_loan: "On long-term loan",
  private: "Private",
  unknown: "Unknown",
};

export const DISPLAY_LABELS: Record<DisplayStatus, string> = {
  on_display: "On display",
  in_storage: "In storage",
  unknown: "Display not known",
};

export const CERTAINTY_LABELS: Record<WhereaboutsCertainty, string> = {
  confirmed: "Confirmed",
  probable: "Probable",
  uncertain: "Uncertain",
};

/** How an attribution reads before a name: "Attributed to Giorgione" */
export const ATTRIBUTION_LABELS: Record<Attribution, string> = {
  unspecified: "By",
  confirmed: "By",
  attributed: "Attributed to",
  uncertain: "Possibly by",
  anonymous: "Anonymous",
  unknown: "Unknown",
};

/** What a painter credit shows: the person, the name credited, or why none */
export function painterName(credit: {
  name?: string | null;
  person?: { name: string } | null;
  creditedAs: string | null;
  attribution: string;
}) {
  return (
    credit.person?.name ??
    credit.name ??
    credit.creditedAs ??
    (credit.attribution === "anonymous" ? "Anonymous" : "Unknown painter")
  );
}

/** A painter credit with its attribution: "Attributed to Giorgione" */
export function attributedName(credit: {
  name?: string | null;
  person?: { name: string } | null;
  creditedAs: string | null;
  attribution: string;
}) {
  const name = painterName(credit);
  const prefix = ATTRIBUTION_LABELS[credit.attribution as Attribution];
  return prefix && prefix !== "By" && credit.attribution !== "anonymous" && credit.attribution !== "unknown"
    ? `${prefix} ${name}`
    : name;
}

function trim(value: number) {
  return Number(value.toFixed(3)).toString();
}

/** "73.7 × 92.1 cm", "73.7 × 92.1 × 4 cm"; null when no dimension is known */
export function dimensionsText(object: {
  height: number | null;
  width: number | null;
  depth: number | null;
  dimensionUnit: string | null;
}) {
  const sides = [object.height, object.width, object.depth];
  if (!object.dimensionUnit || sides.every((side) => side === null)) return null;
  const known = sides.map((side) => (side === null ? "?" : trim(side)));
  if (object.depth === null) known.pop();
  return `${known.join(" × ")} ${object.dimensionUnit}`;
}

/** The name of an object in lists: "Original", "Second version", "Reproduction: poster" */
export function objectName(object: { kind: ArtObjectKind; label: string | null }) {
  const kind = ART_OBJECT_KIND_LABELS[object.kind];
  if (!object.label) return kind;
  return object.kind === "original" ? object.label : `${kind}: ${object.label}`;
}

/** "Museum of Modern Art", "Private collection, Zürich", "You", "Unknown" */
export function ownerText(object: {
  ownership: ArtOwnership;
  ownerName?: string | null;
  ownerLabel?: string | null;
}) {
  switch (object.ownership) {
    case "institutional":
      return object.ownerName ?? "A museum or institution";
    case "private":
      return object.ownerLabel ? `Private collection, ${object.ownerLabel}` : "Private collection";
    case "personal":
      return "You";
    default:
      return "Unknown";
  }
}

/** Where a location record places the object: the venue, a private place, or why none */
export function placeText(record: {
  placeKind: string;
  venueName: string | null;
  placeLabel: string | null;
}) {
  switch (record.placeKind) {
    case "venue":
      return record.venueName ?? "A venue";
    case "private":
      return record.placeLabel ? `Private: ${record.placeLabel}` : "A private place";
    case "lost":
      return "Lost";
    case "destroyed":
      return "Destroyed";
    default:
      return record.placeLabel ?? "Whereabouts unknown";
  }
}

/** "On loan for an exhibition · On display": why it is there and whether it is shown */
export function custodyText(record: { custody: string; displayStatus: string; placeKind: string }) {
  const parts: string[] = [];
  if (record.custody !== "unknown" && record.custody !== "private")
    parts.push(CUSTODY_LABELS[record.custody as WhereaboutsCustody]);
  if (record.placeKind === "venue" && record.displayStatus !== "unknown")
    parts.push(DISPLAY_LABELS[record.displayStatus as DisplayStatus]);
  return parts.join(" · ");
}

/**
 * "Checked Oct 4, 2026" when the record was checked against a source, else
 * "Recorded Oct 4, 2026, not checked": the date a location is known from.
 */
export function checkedText(record: { verifiedAt: Date | null; recordedAt: Date }) {
  const date = (at: Date) =>
    at.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      // The owner's calendar day, not UTC's: a check at 00:30 in Amsterdam is today
      timeZone: appTimeZone(),
    });
  return record.verifiedAt
    ? `Checked ${date(record.verifiedAt)}`
    : `Recorded ${date(record.recordedAt)}, not checked`;
}

/** A painter as the forms hold it; `id` keeps a stored credit across edits */
export interface PainterEntry {
  key: string;
  id?: string;
  personId: string | null;
  name: string | null;
  creditedAs: string | null;
  attribution: Attribution;
}

/** The painters as the services take them, in credited order */
export function painterInput(entries: PainterEntry[]) {
  return entries.map((entry) => ({
    ...(entry.id ? { id: entry.id } : {}),
    personId: entry.personId,
    roleId: "painting.painter",
    creditedAs: entry.creditedAs,
    attribution: entry.attribution,
  }));
}

/** Width over height, kept between 1:3 and 3:1 so no frame becomes a strip */
export function paintingRatio(
  image: { width?: number | null; height?: number | null } | null | undefined,
  size?: { widthCm: number | null; heightCm: number | null } | null,
) {
  const ratio =
    image?.width && image.height
      ? image.width / image.height
      : size?.widthCm && size.heightCm
        ? size.widthCm / size.heightCm
        : 4 / 5;
  return Math.min(3, Math.max(1 / 3, ratio));
}

/** The families that describe a whole painting, in the order of the form */
export const PAINTING_FAMILIES = [
  { key: "genres", label: "Genres", family: { slug: "painting-genres", name: "Painting genres" } },
  { key: "techniques", label: "Techniques", family: { slug: "painting-techniques", name: "Painting techniques" } },
  { key: "media", label: "Media", family: { slug: "painting-media", name: "Painting media" } },
  { key: "supports", label: "Supports", family: { slug: "painting-supports", name: "Painting supports" } },
] as const;
export type PaintingFamilyKey = (typeof PAINTING_FAMILIES)[number]["key"];
