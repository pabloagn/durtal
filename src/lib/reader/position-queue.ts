import type { DurtalLocator } from "./engine";

/**
 * Saving the place, off the input path (eBooks sub-issue 3). A page turn
 * only queues its place; the newest queued place is sent at most once every
 * 2 seconds. When the page goes away (pagehide) or the tab is hidden
 * (visibilitychange), what is still queued goes out with sendBeacon, which
 * the browser delivers after the page is gone: iOS Safari does not reliably
 * fire beforeunload, which is where the old reader lost its last seconds.
 * A send that fails stays queued for the next flush, unless a newer place
 * replaced it.
 */

export interface PositionSave {
  fileId: string;
  locator: DurtalLocator;
  chapter: string | null;
  /** When the reader was there, ISO 8601: the server keeps the newest */
  clientUpdatedAt: string;
}

export interface PositionQueueOptions {
  /** POST /api/reader/[ebookId]/position */
  url: string;
  /** At most one request in this many ms */
  interval?: number;
  fetch?: typeof fetch;
  sendBeacon?: (url: string, data: Blob) => boolean;
  /** Where pagehide and visibilitychange are heard; none in tests that flush by hand */
  window?: Window | null;
}

export interface PositionQueue {
  push(save: PositionSave): void;
  /** Sends what is queued now; `beacon` when the page is going away */
  flush(options?: { beacon?: boolean }): void;
  /** Whether a place is still waiting to be sent */
  readonly pending: boolean;
  destroy(): void;
}

export const SAVE_INTERVAL_MS = 2000;

export function createPositionQueue(options: PositionQueueOptions): PositionQueue {
  const interval = options.interval ?? SAVE_INTERVAL_MS;
  const win = options.window === undefined ? (typeof window === "undefined" ? null : window) : options.window;
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const beacon =
    options.sendBeacon ??
    (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
      ? (url: string, data: Blob) => navigator.sendBeacon(url, data)
      : null);

  let queued: PositionSave | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let destroyed = false;

  // The first turn waits the whole interval and the turns after it join it: one request
  const schedule = () => {
    if (timer || destroyed || !queued) return;
    timer = setTimeout(send, interval);
  };

  async function send() {
    timer = null;
    if (!queued || destroyed) return;
    if (inFlight) {
      schedule();
      return;
    }
    const save = queued;
    queued = null;
    inFlight = true;
    let ok = false;
    try {
      const res = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(save),
        keepalive: true,
      });
      // A refusal (a bad place, a file gone) is not worth sending again
      ok = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429);
    } catch {
      ok = false;
    } finally {
      inFlight = false;
    }
    // Kept for the next flush, unless a newer place came meanwhile
    if (!ok && !queued) queued = save;
    if (queued && ok) schedule();
  }

  const flush = ({ beacon: useBeacon = false } = {}) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!queued || destroyed) return;
    if (useBeacon && beacon) {
      const blob = new Blob([JSON.stringify(queued)], { type: "application/json" });
      if (beacon(options.url, blob)) {
        queued = null;
        return;
      }
    }
    void send();
  };

  const onPageHide = () => flush({ beacon: true });
  const onVisibility = () => {
    if (win?.document.visibilityState === "hidden") flush({ beacon: true });
  };
  win?.addEventListener("pagehide", onPageHide);
  win?.document.addEventListener("visibilitychange", onVisibility);

  return {
    push(save) {
      queued = save;
      schedule();
    },
    flush,
    get pending() {
      return !!queued;
    },
    destroy() {
      flush({ beacon: true });
      destroyed = true;
      if (timer) clearTimeout(timer);
      win?.removeEventListener("pagehide", onPageHide);
      win?.document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
