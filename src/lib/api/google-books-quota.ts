import { reportSearchFailure } from "./search-diagnostics";

/**
 * Google Books answers 429 (or 403 with a quota reason) when the key, or the
 * shared anonymous quota without one, is used up (SLN-425). Every Google Books
 * call goes through `googleBooksFetch`, which:
 *
 * - retries a refused call twice, after 250 ms and 500 ms (or the server's
 *   Retry-After when that is shorter than 2 s), and only one call at a time
 *   retries: the others give up at once;
 * - after that, stops calling Google Books for a cool-down that doubles on
 *   each refusal in a row (30 s, 1 min, 2 min … 15 min), so a busy search
 *   never hammers the API; a call that works ends the cool-down;
 * - has one time limit for the whole call, retries included;
 * - keeps the last call's outcome for the settings integrations page.
 */

/** In-request retries, in milliseconds */
export const GOOGLE_BOOKS_RETRY_DELAYS_MS = [250, 500] as const;
const RETRY_AFTER_MAX_MS = 2000;
const COOLDOWN_BASE_MS = 30_000;
const COOLDOWN_MAX_MS = 15 * 60_000;
/** The time limit of a whole call, retries included, unless the caller gives another */
export const GOOGLE_BOOKS_TIMEOUT_MS = 8000;
const QUOTA_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
  "quotaExceeded",
]);

export const GOOGLE_BOOKS_QUOTA_MESSAGE =
  "Google Books is over its quota. Results from the other sources are shown; try again in a few minutes.";

/** Thrown while Google Books refuses calls, or is cooling down after it did */
export class GoogleBooksQuotaError extends Error {
  constructor() {
    super(GOOGLE_BOOKS_QUOTA_MESSAGE);
    this.name = "GoogleBooksQuotaError";
  }
}

export interface GoogleBooksCall {
  at: Date;
  outcome: "ok" | "quota" | "error";
  /** The HTTP status, when Google answered */
  status?: number;
}

interface QuotaState {
  /** Refusals in a row, across requests */
  refusals: number;
  /** No call before this time (epoch ms) */
  until: number;
  last: GoogleBooksCall | null;
}

/**
 * One state per server process. Next.js bundles route handlers, server
 * actions and pages apart, each with its own copy of this module, so the
 * state lives on `globalThis`: the search, Match and the settings page see
 * the same cool-down and last call.
 */
const holder = globalThis as typeof globalThis & {
  __durtalGoogleBooksQuota?: QuotaState;
};
const state: QuotaState = (holder.__durtalGoogleBooksQuota ??= {
  refusals: 0,
  until: 0,
  last: null,
});

/** Whether Google Books is cooling down after refusing calls */
export function googleBooksOverQuota(now = Date.now()) {
  return now < state.until;
}

/** The last Google Books call since the app started, if any */
export function lastGoogleBooksCall(): GoogleBooksCall | null {
  return state.last;
}

/** Forget the cool-down and the last call (tests) */
export function resetGoogleBooksQuota() {
  state.refusals = 0;
  state.until = 0;
  state.last = null;
}

/** 429, or 403 with a quota reason. The body is read, never logged. */
async function isQuotaRefusal(res: Response) {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  try {
    const body = (await res.clone().json()) as {
      error?: { errors?: { reason?: string }[] };
    };
    return (body.error?.errors ?? []).some(
      (e) => !!e.reason && QUOTA_REASONS.has(e.reason),
    );
  } catch {
    return false;
  }
}

/** Retry-After in ms, when it is a number of seconds; null when it is missing */
function retryAfterMs(res: Response) {
  const header = res.headers.get("retry-after")?.trim();
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` for Google Books. Returns the response of any call that is not a
 * quota refusal (the caller checks `ok`); throws `GoogleBooksQuotaError`
 * when Google Books keeps refusing or is cooling down. `timeoutMs` is the
 * time limit of the whole call: the retries share it.
 */
export async function googleBooksFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = GOOGLE_BOOKS_TIMEOUT_MS,
): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  for (let attempt = 0; ; attempt++) {
    if (googleBooksOverQuota()) throw new GoogleBooksQuotaError();
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (error) {
      state.last = { at: new Date(), outcome: "error" };
      throw error;
    }
    if (!(await isQuotaRefusal(res))) {
      state.refusals = 0;
      state.until = 0;
      state.last = { at: new Date(), outcome: res.ok ? "ok" : "error", status: res.status };
      return res;
    }
    state.last = { at: new Date(), outcome: "quota", status: res.status };
    // A refused answer is not read: free its connection
    await res.body?.cancel().catch(() => undefined);
    const hinted = retryAfterMs(res);
    const delay = GOOGLE_BOOKS_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined && (hinted === null || hinted <= RETRY_AFTER_MAX_MS)) {
      // This call retries; the others see the short gate and give up
      const wait = hinted ?? delay;
      const gate = Date.now() + wait;
      state.until = gate;
      await sleep(wait);
      // Lift only this call's gate, never a cool-down another call opened
      if (state.until === gate) state.until = 0;
      continue;
    }
    // Another call's pause is already running: it counted this refusal
    if (googleBooksOverQuota()) throw new GoogleBooksQuotaError();
    state.refusals += 1;
    const cooldown = Math.min(
      COOLDOWN_MAX_MS,
      Math.max(hinted ?? 0, COOLDOWN_BASE_MS * 2 ** (state.refusals - 1)),
    );
    state.until = Date.now() + cooldown;
    reportSearchFailure("google_books", res.status);
    throw new GoogleBooksQuotaError();
  }
}
