/**
 * Image uploads sent at a time. A gallery drop of 30 twelve-megapixel photos
 * sent all at once grew the server process by 1.1 GB (SLN-1461).
 */
export const UPLOADS_AT_ONCE = 2;

export interface UploadQueue {
  /** Sends `task` once fewer than the limit are being sent */
  add(id: string, task: () => Promise<void>): void;
  /** Drops every upload not yet started and returns their ids; ones being sent finish */
  cancel(): string[];
}

/**
 * Runs uploads a few at a time. While any is waiting or being sent, leaving
 * or reloading the page asks first, even after the drop zone has closed,
 * since the photos not yet sent would be lost.
 */
export function createUploadQueue(limit = UPLOADS_AT_ONCE): UploadQueue {
  const waiting: { id: string; task: () => Promise<void> }[] = [];
  let sending = 0;

  function onBeforeUnload(event: BeforeUnloadEvent) {
    event.preventDefault();
    event.returnValue = "";
  }
  function settle() {
    if (sending === 0 && waiting.length === 0) window.removeEventListener("beforeunload", onBeforeUnload);
  }
  function next() {
    while (sending < limit && waiting.length > 0) {
      const { task } = waiting.shift()!;
      sending++;
      void task()
        .catch(() => {})
        .finally(() => {
          sending--;
          next();
          settle();
        });
    }
  }

  return {
    add(id, task) {
      if (sending === 0 && waiting.length === 0) window.addEventListener("beforeunload", onBeforeUnload);
      waiting.push({ id, task });
      next();
    },
    cancel() {
      const dropped = waiting.splice(0).map((item) => item.id);
      settle();
      return dropped;
    },
  };
}
