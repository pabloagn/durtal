import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleBooksQuotaError,
  googleBooksFetch,
  googleBooksOverQuota,
  lastGoogleBooksCall,
  resetGoogleBooksQuota,
} from "@/lib/api/google-books-quota";
import { searchGoogleBooks } from "@/lib/api/google-books";
import { searchNotices } from "@/lib/api/search-engine";

const fetchMock = vi.fn<typeof fetch>();
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });
const quota403 = () =>
  response({ error: { errors: [{ reason: "dailyLimitExceeded" }] } }, 403);
const URL_ = "https://www.googleapis.com/books/v1/volumes?q=x";
const init = {};

/** Runs a call while the fake clock moves past every retry delay */
async function settle<T>(promise: Promise<T>) {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
}

beforeEach(() => {
  resetGoogleBooksQuota();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("Google Books quota back-off", () => {
  it("retries twice with growing delays, then gives up and cools down", async () => {
    fetchMock.mockImplementation(async () => response({}, 429));
    const outcome = await settle(googleBooksFetch(URL_, init));
    expect(outcome).toEqual({ error: expect.any(GoogleBooksQuotaError) });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[book-search] google_books: HTTP 429");
    expect(googleBooksOverQuota()).toBe(true);
    expect(lastGoogleBooksCall()).toMatchObject({ outcome: "quota", status: 429 });
  });

  it("makes no call while cooling down, and the cool-down doubles", async () => {
    fetchMock.mockImplementation(async () => response({}, 429));
    await settle(googleBooksFetch(URL_, init));
    fetchMock.mockClear();
    await expect(googleBooksFetch(URL_, init)).rejects.toBeInstanceOf(GoogleBooksQuotaError);
    expect(fetchMock).not.toHaveBeenCalled();
    // First cool-down: 30 s
    vi.advanceTimersByTime(29_000);
    expect(googleBooksOverQuota()).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(googleBooksOverQuota()).toBe(false);
    // Refused again: the next cool-down is 60 s
    await settle(googleBooksFetch(URL_, init));
    vi.advanceTimersByTime(45_000);
    expect(googleBooksOverQuota()).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(googleBooksOverQuota()).toBe(false);
  });

  it("waits 250 ms, then 500 ms, when Google sends no Retry-After", async () => {
    fetchMock.mockImplementation(async () => response({}, 429));
    const outcome = googleBooksFetch(URL_, init).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await outcome).toBeInstanceOf(GoogleBooksQuotaError);
  });

  it("treats a blank Retry-After as missing", async () => {
    fetchMock.mockImplementation(async () => response({}, 429, { "retry-after": " " }));
    const outcome = googleBooksFetch(URL_, init).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await outcome;
  });

  it("lets one call retry while the others give up at once", async () => {
    fetchMock.mockImplementation(async () => response({}, 429));
    const calls = [1, 2, 3, 4, 5].map(() => settle(googleBooksFetch(URL_, init)));
    const outcomes = await Promise.all(calls);
    expect(outcomes.every((o) => "error" in o)).toBe(true);
    // Five first calls, then the two retries of one of them
    expect(fetchMock).toHaveBeenCalledTimes(7);
    fetchMock.mockClear();
    // Cooling down now: nothing goes out
    await expect(googleBooksFetch(URL_, init)).rejects.toBeInstanceOf(GoogleBooksQuotaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets only one of the calls in flight retry", async () => {
    // Google answers after 100 ms: four queries of one search are in flight
    // when the first refusal comes back
    fetchMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(response({}, 429)), 100)),
    );
    const outcomes = await Promise.all(
      [1, 2, 3, 4].map(() => settle(googleBooksFetch(URL_, init))),
    );
    expect(outcomes.every((o) => "error" in o)).toBe(true);
    // Four first calls, then the two retries of one of them
    expect(fetchMock).toHaveBeenCalledTimes(6);
    // One refusal counted: the first cool-down, 30 s
    expect(googleBooksOverQuota()).toBe(true);
    vi.advanceTimersByTime(29_000);
    expect(googleBooksOverQuota()).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(googleBooksOverQuota()).toBe(false);
  });

  it("counts one refusal for calls that give up together", async () => {
    // One search sends four Google queries at once
    fetchMock.mockImplementation(async () => response({}, 429));
    await Promise.all([1, 2, 3, 4].map(() => settle(googleBooksFetch(URL_, init))));
    // The first cool-down, 30 s, not one doubled for each query
    vi.advanceTimersByTime(29_000);
    expect(googleBooksOverQuota()).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(googleBooksOverQuota()).toBe(false);
  });

  it("keeps one time limit for the whole call, retries included", async () => {
    fetchMock.mockImplementation(async () => response({}, 429));
    await settle(googleBooksFetch(URL_, init));
    const signals = fetchMock.mock.calls.map(([, options]) => options?.signal);
    expect(signals).toHaveLength(3);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(new Set(signals).size).toBe(1);
  });

  it("frees the body of a refused answer", async () => {
    const cancel = vi.fn(async () => {});
    fetchMock.mockImplementation(async () => {
      const res = response({}, 429, { "retry-after": "120" });
      Object.defineProperty(res, "body", { value: { cancel } });
      return res;
    });
    await settle(googleBooksFetch(URL_, init));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("ends the cool-down when a call works", async () => {
    fetchMock.mockImplementationOnce(async () => response({}, 429));
    fetchMock.mockImplementation(async () => response({ items: [] }));
    const outcome = await settle(googleBooksFetch(URL_, init));
    expect("value" in outcome && outcome.value.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(googleBooksOverQuota()).toBe(false);
    expect(lastGoogleBooksCall()).toMatchObject({ outcome: "ok", status: 200 });
  });

  it("treats a 403 with a quota reason as the quota, and another 403 as an error", async () => {
    fetchMock.mockImplementation(async () => quota403());
    expect(await settle(googleBooksFetch(URL_, init))).toEqual({ error: expect.any(GoogleBooksQuotaError) });
    resetGoogleBooksQuota();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => response({ error: { errors: [{ reason: "forbidden" }] } }, 403));
    const outcome = await settle(googleBooksFetch(URL_, init));
    expect("value" in outcome && outcome.value.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(googleBooksOverQuota()).toBe(false);
  });

  it("follows a long Retry-After without retrying first", async () => {
    fetchMock.mockImplementation(async () => response({}, 429, { "retry-after": "120" }));
    await settle(googleBooksFetch(URL_, init));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(110_000);
    expect(googleBooksOverQuota()).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(googleBooksOverQuota()).toBe(false);
  });
});

describe("what the search shows", () => {
  it("returns no Google results and a notice instead of a silent empty list", async () => {
    fetchMock.mockImplementation(async () => response({}, 429));
    const outcome = await settle(searchGoogleBooks("Lanark"));
    expect(outcome).toEqual({ value: [] });
    expect(searchNotices()).toEqual([
      "Google Books is over its quota. Results from the other sources are shown; try again in a few minutes.",
    ]);
  });

  it("has no notice when Google Books answers", async () => {
    fetchMock.mockImplementation(async () => response({ items: [] }));
    await settle(searchGoogleBooks("Lanark"));
    expect(searchNotices()).toEqual([]);
  });
});
