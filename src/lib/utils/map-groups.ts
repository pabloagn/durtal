/**
 * Helpers for the authors map: turn the GeoJSON features under a click into
 * a list of authors, grouped by nationality.
 *
 * Authors without a birthplace are placed on their country's centroid, so all
 * authors of one country share one exact point. Such a stack never splits
 * into separate points, however far the map zooms in.
 */

export interface MapAuthorLeaf {
  id: string;
  name: string;
  slug: string;
  birthYear: number | null;
  deathYear: number | null;
  nationalityCode: string | null;
  nationalityName: string | null;
  locationName: string;
  longitude: number;
  latitude: number;
}

export interface MapNationalityGroup {
  code: string;
  name: string;
  count: number;
}

export interface MapAuthorGroup {
  /** Authors sorted by name */
  authors: MapAuthorLeaf[];
  /** Nationalities present, most authors first */
  nationalities: MapNationalityGroup[];
  /** Most common location name among the authors */
  locationName: string;
}

/** Coordinates closer than this (in degrees) count as the same spot */
const SAME_SPOT_EPSILON = 1e-6;

/** True when every point sits on the same spot. */
export function isSingleSpot(points: { longitude: number; latitude: number }[]): boolean {
  if (points.length === 0) return false;
  const [first] = points;
  return points.every(
    (p) =>
      Math.abs(p.longitude - first.longitude) < SAME_SPOT_EPSILON &&
      Math.abs(p.latitude - first.latitude) < SAME_SPOT_EPSILON,
  );
}

/** Mapbox can return null feature properties as missing or as the string "null". */
function readString(value: unknown): string | null {
  if (value == null || value === "null" || value === "") return null;
  return String(value);
}

function readNumber(value: unknown): number | null {
  const s = readString(value);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read an author from a GeoJSON point feature of the authors map source.
 * Returns null for features that are not author points (e.g. clusters).
 */
export function leafFromFeature(feature: {
  geometry: { type: string; coordinates?: unknown };
  properties?: Record<string, unknown> | null;
}): MapAuthorLeaf | null {
  const props = feature.properties ?? {};
  const id = readString(props.id);
  const coords = feature.geometry.coordinates;
  if (!id || feature.geometry.type !== "Point" || !Array.isArray(coords)) return null;

  return {
    id,
    name: readString(props.name) ?? "",
    slug: readString(props.slug) ?? "",
    birthYear: readNumber(props.birthYear),
    deathYear: readNumber(props.deathYear),
    nationalityCode: readString(props.nationalityCode),
    nationalityName: readString(props.nationalityName),
    locationName: readString(props.locationName) ?? "",
    longitude: Number(coords[0]),
    latitude: Number(coords[1]),
  };
}

/** Group authors by nationality and sort them for display. */
export function groupMapAuthors(leaves: MapAuthorLeaf[]): MapAuthorGroup {
  const authors = [...leaves].sort((a, b) => a.name.localeCompare(b.name));

  const byCode = new Map<string, MapNationalityGroup>();
  for (const a of authors) {
    if (!a.nationalityCode) continue;
    const group = byCode.get(a.nationalityCode);
    if (group) {
      group.count += 1;
    } else {
      byCode.set(a.nationalityCode, {
        code: a.nationalityCode,
        name: a.nationalityName ?? a.nationalityCode,
        count: 1,
      });
    }
  }
  const nationalities = [...byCode.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );

  const locationCounts = new Map<string, number>();
  for (const a of authors) {
    if (a.locationName) locationCounts.set(a.locationName, (locationCounts.get(a.locationName) ?? 0) + 1);
  }
  let locationName = "";
  let best = 0;
  for (const [name, count] of locationCounts) {
    if (count > best) {
      best = count;
      locationName = name;
    }
  }

  return { authors, nationalities, locationName };
}
