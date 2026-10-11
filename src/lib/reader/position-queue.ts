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
  flush(options?: { beacon?: boolean }): Promise<boolean>;
  /** Whether a place is still waiting to be sent */
  readonly pending: boolean;
  destroy(): void;
}

export const SAVE_INTERVAL_MS = 2000;

export function createPositionQueue(
  options: PositionQueueOptions,
): PositionQueue {
  const interval = options.interval ?? SAVE_INTERVAL_MS;
  const win =
    options.window === undefined
      ? typeof window === "undefined"
        ? null
        : window
      : options.window;
  const doFetch =
    options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const beacon =
    options.sendBeacon ??
    (typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function"
      ? (url: string, data: Blob) => navigator.sendBeacon(url, data)
      : null);

  let queued: PositionSave | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<boolean> | null = null;
  let destroyed = false;

  // The first turn waits the whole interval and the turns after it join it: one request
  const schedule = () => {
    if (timer || destroyed || !queued) return;
    timer = setTimeout(send, interval);
  };

  function send(): Promise<boolean> {
    timer = null;
    if (inFlight) return inFlight;
    if (!queued || destroyed) return Promise.resolve(true);
    const save = queued;
    queued = null;
    inFlight = (async () => {
      let ok = false;
      try {
        const res = await doFetch(options.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(save),
          keepalive: true,
        });
        ok =
          res.ok ||
          (res.status >= 400 &&
            res.status < 500 &&
            res.status !== 408 &&
            res.status !== 429);
      } catch {
        ok = false;
      }
      if (!ok && !queued) queued = save;
      return ok;
    })();
    const flight = inFlight;
    void flight.then((ok) => {
      inFlight = null;
      if (queued && ok) schedule();
    });
    return flight;
  }

  const flush = async ({
    beacon: useBeacon = false,
  } = {}): Promise<boolean> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (destroyed) return false;
    if (useBeacon && queued && beacon) {
      const blob = new Blob([JSON.stringify(queued)], {
        type: "application/json",
      });
      if (beacon(options.url, blob)) {
        queued = null;
        return true;
      }
    }
    if (inFlight && !(await inFlight)) return false;
    // A turn arriving during an in-flight save must be sent before a refresh GET.
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    return send();
  };

  const onPageHide = () => flush({ beacon: true });
  const onVisibility = () => {
    if (win?.document.visibilityState === "hidden") flush({ beacon: true });
  };
  win?.addEventListener("pagehide", onPageHide);
  win?.document.addEventListener("visibilitychange", onVisibility);

  return {
    push(save) {
      if (destroyed) return;
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
