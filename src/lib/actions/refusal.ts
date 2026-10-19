import { CONNECTION_SAVE_ERROR, isConnectionFailure } from "@/lib/notifications/connection";
import { ActionRefusal } from "./action-refusal";

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
