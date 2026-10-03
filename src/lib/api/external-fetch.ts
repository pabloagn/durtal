/**
 * Outgoing HTTP calls (SLN-299). Every call has a time limit, so a service
 * that does not answer cannot hang a request. A failed call becomes an
 * `ExternalFetchError` that names the host and says what went wrong.
 */

/** The time limit of an outgoing call, unless the caller gives another */
export const EXTERNAL_TIMEOUT_MS = 8000;

export class ExternalFetchError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or null when no answer came */
    readonly status: number | null,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = "ExternalFetchError";
  }
}

const host = (url: string | URL) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url);
  }
};

/** `fetch` with a time limit. A caller's own signal still works. */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  ms = EXTERNAL_TIMEOUT_MS,
): Promise<Response> {
  const limit = AbortSignal.timeout(ms);
  const signal = init.signal ? AbortSignal.any([init.signal, limit]) : limit;
  try {
    return await fetch(url, { ...init, signal });
  } catch (err) {
    if (limit.aborted)
      throw new ExternalFetchError(
        `${host(url)} did not answer within ${ms / 1000} s`,
        null,
        true,
      );
    throw err;
  }
}

/** `fetchWithTimeout`, and an answer that is not OK throws */
export async function fetchOk(
  url: string | URL,
  init: RequestInit = {},
  ms = EXTERNAL_TIMEOUT_MS,
): Promise<Response> {
  const res = await fetchWithTimeout(url, init, ms);
  if (!res.ok)
    throw new ExternalFetchError(
      `${host(url)} answered ${res.status}`,
      res.status,
    );
  return res;
}

/**
 * Runs tasks one at a time, each starting at least `gapMs` after the one
 * before (Nominatim allows one request per second). Concurrent callers
 * queue up instead of reading the same "last request" time.
 */
export function serialThrottle(gapMs: number) {
  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      const wait = lastStart + gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStart = Date.now();
      return task();
    });
    // A failed task does not stop the ones after it
    queue = result.catch(() => undefined);
    return result;
  };
}
