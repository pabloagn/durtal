import { CONNECTION_SAVE_ERROR, isConnectionFailure } from "@/lib/notifications/connection";

/**
 * A deliberate refusal the server sent as data (`actionResult`), raised again
 * on the client by the UI adapters (`catalogue-client`, `taxonomy-client`).
 * Its message is written for people.
 */
export class ActionRefusal extends Error {
  /** A page that settles the refusal, when the server named one */
  readonly href?: string;
  constructor(message: string, href?: string) {
    super(message);
    this.name = "ActionRefusal";
    if (href) this.href = href;
  }
}

/**
 * The toast action that opens the page a refusal named, such as the book that
 * already holds an ISBN, as the add wizard links it (SLN-1033)
 */
export function refusalAction(
  error: unknown,
  open: (href: string) => void,
): { action: { label: string; onClick: () => void } } | undefined {
  const href = error instanceof ActionRefusal ? error.href : undefined;
  return href ? { action: { label: "Open that book", onClick: () => open(href) } } : undefined;
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
