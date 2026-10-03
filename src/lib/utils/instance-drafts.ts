/**
 * Rules for the copy (instance) drafts in the add-book wizard.
 */

/**
 * The location a new copy starts with: the default location from Settings
 * when it is one of the locations offered, else none ("").
 */
export function newCopyLocationId(
  locations: { id: string }[],
  defaultId: string | null,
): string {
  return defaultId && locations.some((l) => l.id === defaultId) ? defaultId : "";
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
