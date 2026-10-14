import type { StoredOperation } from "./store";

/** Failed sends of the head before the reader says sync is paused */
export const PAUSED_AFTER_ATTEMPTS = 3;

/**
 * Whether the reader should say sync is paused (SLN-668): the head of the
 * outbox is blocked, or has failed to send several times in a row. Being
 * offline is not a pause: the queue waits for the network on its own.
 */
export function syncPaused(
  rows: readonly Pick<StoredOperation, "state" | "attempts">[],
  online: boolean,
): boolean {
  const head = rows[0];
  if (!head || !online) return false;
  return (
    head.state === "blocked" ||
    (head.state === "waiting" && head.attempts >= PAUSED_AFTER_ATTEMPTS)
  );
}
