/** Digital identity, status and size are set by the matching planner. The
 * server's shared strict schema validates these descriptive values at prepare. */
export function reviewCopyMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const reserved = new Set(["editionId", "locationId", "format", "fileSizeBytes", "status"]);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !reserved.has(key)));
}
