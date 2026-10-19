/** Shown when a write never reached Durtal */
export const CONNECTION_SAVE_ERROR = "Not saved: Durtal could not be reached. Check the connection and try again.";

const NETWORK_FAILURES = new Set(["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]);

/** The browser's own words for a request that never reached Durtal */
export function isConnectionFailure(message: string): boolean {
  return NETWORK_FAILURES.has(message.trim());
}
