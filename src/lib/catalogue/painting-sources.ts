import { stableStringify } from "@/lib/harmonization/normalize";
import { CENTIMETRES_PER_UNIT, DIMENSION_UNITS } from "./paintings";

/*
 * Where facts about a painting can come from (SLN-378). The museums Durtal
 * looks up have documented open APIs without a key; the others are cited by
 * hand. No museum's answer is ever read as the object's location unless the
 * museum itself says the object is on view in its galleries.
 */

export interface PaintingSource {
  name: string;
  access: "lookup" | "cite";
  why: string;
  covers: string;
}

export const PAINTING_SOURCES: readonly PaintingSource[] = [
  {
    name: "Art Institute of Chicago",
    access: "lookup",
    why: "A documented open API without a key; CC0 data and public-domain images",
    covers: "Its own collection: title, attribution, date, medium, size in centimetres, reference number, image, and whether it is on view now and where",
  },
  {
    name: "The Met",
    access: "lookup",
    why: "A documented open API without a key; CC0 data and public-domain images",
    covers: "Its own collection: title, attribution, date, medium, size in centimetres, accession number, image, and its gallery when on view",
  },
  {
    name: "Cleveland Museum of Art",
    access: "cite",
    why: "An open API without a key, not connected yet",
    covers: "Its own collection, with the current gallery",
  },
  {
    name: "Rijksmuseum",
    access: "cite",
    why: "Its collection API needs a personal key",
    covers: "Its own collection",
  },
  {
    name: "Smithsonian Open Access",
    access: "cite",
    why: "Its API needs an api.data.gov key",
    covers: "The Smithsonian museums' collections",
  },
  {
    name: "Wikidata",
    access: "cite",
    why: "Its collection and location statements carry no dates, so they cannot place an object now",
    covers: "Owning collection, inventory numbers and identifiers of well-known works",
  },
];

type Unit = (typeof DIMENSION_UNITS)[number];

/** Two sizes within 0.5 cm are the same size, measured twice */
export const DIMENSION_TOLERANCE_CM = 0.5;

export interface Size {
  height: number | null;
  width: number | null;
  depth: number | null;
  unit: Unit | null;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** "73.7 × 92.1 cm", in the size's own unit */
export function sizeText(size: Size) {
  const parts = [size.height, size.width, size.depth].filter((v): v is number => v !== null).map((v) => String(round(v)));
  return parts.length && size.unit ? `${parts.join(" × ")} ${size.unit}` : null;
}

/** A size in another unit, kept to the thousandth the database stores */
export function convertSize(size: Size, unit: Unit): Size {
  if (!size.unit) return { ...size, unit };
  const factor = CENTIMETRES_PER_UNIT[size.unit] / CENTIMETRES_PER_UNIT[unit];
  const to = (v: number | null) => (v === null ? null : round(v * factor));
  return { height: to(size.height), width: to(size.width), depth: to(size.depth), unit };
}

/**
 * A museum's size beside the size here, whatever unit each uses. Empty
 * here: fill. Within the tolerance on height and width: the same. Otherwise
 * a conflict, and the size here stays.
 */
export function compareSizes(here: Size, museum: Size): "fill" | "same" | "conflict" {
  if (here.height === null && here.width === null) return "fill";
  if (!here.unit || !museum.unit) return "conflict";
  const a = convertSize(here, "cm");
  const b = convertSize(museum, "cm");
  const near = (x: number | null, y: number | null) => x === null || y === null || Math.abs(x - y) <= DIMENSION_TOLERANCE_CM;
  return near(a.height, b.height) && near(a.width, b.width) && (a.height !== null || a.width !== null) ? "same" : "conflict";
}

export interface SourceChange {
  field: string;
  before: string | null;
  after: string | null;
}

/** What changed between two answers of one source, field by field, as text */
export function sourceChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  show: (field: string, value: unknown) => string | null,
): SourceChange[] {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields
    .filter((field) => stableStringify(before[field] ?? null) !== stableStringify(after[field] ?? null))
    .map((field) => ({ field, before: show(field, before[field] ?? null), after: show(field, after[field] ?? null) }));
}
