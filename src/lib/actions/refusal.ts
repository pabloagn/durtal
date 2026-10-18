import { CONNECTION_SAVE_ERROR, isConnectionFailure } from "@/lib/notifications/connection";

/**
 * A deliberate refusal the server sent as data (`actionResult`), raised again
 * on the client by the UI adapters (`catalogue-client`, `taxonomy-client`).
 * Its message is written for people.
 */
export class ActionRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionRefusal";
  }
}

/**
 * What to tell someone a write did not happen: the server's own reason for a
 * refusal, the connection message when Durtal could not be reached, else the
 * caller's own words. An unexpected failure's message is Next's or the
 * engine's, never one to show (SLN-1033).
 */
export function refusalMessage(error: unknown, fallback: string): string {
  if (error instanceof ActionRefusal) return error.message;
  if (error instanceof Error && isConnectionFailure(error.message)) return CONNECTION_SAVE_ERROR;
  return fallback;
}
