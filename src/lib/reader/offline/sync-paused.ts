import type { StoredOperation } from "./store";

/** Failed sends of the head before the reader says sync is paused */
export const PAUSED_AFTER_ATTEMPTS = 3;
/** How long one head may stay first in the queue, online, before the reader
 * says sync is paused: covers a server that cannot be reached at all, where
 * the device check fails before any send counts as an attempt (review #273) */
export const PAUSED_AFTER_MS = 120_000;

/**
 * Whether the reader should say sync is paused (SLN-668): the head of the
 * outbox is blocked, or has failed to send several times in a row. Being
 * offline is not a pause: the queue waits for the network on its own.
 * `firstMs` is how long this head has been first in the queue.
 */
export function syncPaused(
  rows: readonly Pick<StoredOperation, "state" | "attempts">[],
  online: boolean,
  firstMs = 0,
): boolean {
  const head = rows[0];
  if (!head || !online) return false;
  return (
    head.state === "blocked" ||
    (head.state === "waiting" &&
      (head.attempts >= PAUSED_AFTER_ATTEMPTS || firstMs >= PAUSED_AFTER_MS))
  );
}
