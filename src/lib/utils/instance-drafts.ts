/**
 * Rules for the copy (instance) drafts in the add-book wizard.
 */

/** Locations tried first for a new copy, in order (matched by name). */
const PREFERRED_LOCATION_NAMES = ["amsterdam", "mexico city"];

/**
 * The location a new copy starts with: the first preferred location that
 * exists, else the first location, else none ("").
 */
export function pickDefaultLocationId(locations: { id: string; name: string }[]): string {
  for (const preferred of PREFERRED_LOCATION_NAMES) {
    const match = locations.find((l) => l.name.toLowerCase().includes(preferred));
    if (match) return match.id;
  }
  return locations[0]?.id ?? "";
}

/**
 * The drafts that become copies on submit. Skipping copies means the book is
 * not owned yet, so nothing is created, whatever the drafts hold. A draft
 * without a location is incomplete and is never created.
 */
export function draftsToCreate<T extends { locationId: string }>(
  drafts: T[],
  skipCopies: boolean,
): T[] {
  if (skipCopies) return [];
  return drafts.filter((d) => d.locationId);
}
