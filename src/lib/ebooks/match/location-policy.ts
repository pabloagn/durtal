/** Automatic creation uses the configured eBooks location; an explicit copy
 * may be at any active digital location. Neither route changes its location. */
export function digitalLocationAllowed(
  location: { id: string; type: string; isActive: boolean } | undefined,
  configuredId: string | null,
  explicitCopy = false,
): boolean {
  return (
    !!location &&
    location.type === "digital" &&
    location.isActive &&
    (explicitCopy || location.id === configuredId)
  );
}
