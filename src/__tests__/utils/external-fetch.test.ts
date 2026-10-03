import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExternalFetchError,
  fetchOk,
  fetchWithTimeout,
  serialThrottle,
} from "@/lib/api/external-fetch";
import { deduplicateResults } from "@/lib/api/search-engine";
import type { SearchResult } from "@/lib/api/types";

afterEach(() => vi.restoreAllMocks());

/** A service that answers only when the call is aborted */
function silentService() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "TimeoutError")),
        ),
      ),
  );
}

describe("outgoing calls", () => {
  it("stop after the time limit and name the host", async () => {
    silentService();
    const call = fetchWithTimeout("https://nominatim.example/search", {}, 30);
    await expect(call).rejects.toBeInstanceOf(ExternalFetchError);
    await expect(
      fetchWithTimeout("https://nominatim.example/search", {}, 30),
    ).rejects.toThrow("nominatim.example did not answer within 0.03 s");
  });

  it("turn an answer that is not OK into an error with its status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>busy</html>", { status: 429 }),
    );
    const err = await fetchOk("https://nominatim.example/search").catch((e) => e);
    expect(err).toBeInstanceOf(ExternalFetchError);
    expect(err.status).toBe(429);
    expect(err.timedOut).toBe(false);
  });

  it("keep the caller's own abort signal", async () => {
    silentService();
    const controller = new AbortController();
    const call = fetchWithTimeout("https://x.example", { signal: controller.signal }, 5000);
    controller.abort();
    await expect(call).rejects.not.toBeInstanceOf(ExternalFetchError);
  });
});

describe("serial throttle", () => {
  it("starts concurrent tasks one gap apart, and a failure does not block the queue", async () => {
    const run = serialThrottle(40);
    const starts: number[] = [];
    const task = (fail = false) => () => {
      starts.push(Date.now());
      return fail ? Promise.reject(new Error("429")) : Promise.resolve("ok");
    };
    const results = await Promise.allSettled([run(task()), run(task(true)), run(task())]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(38);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(38);
  });
});

describe("search results without an ISBN", () => {
  const result = (title: string, author: string): SearchResult => ({
    source: "open_library",
    sourceId: title,
    title,
    authors: [author],
    categories: [],
  });

  it("keep two different non-Latin titles apart", () => {
    const merged = deduplicateResults([
      result("Мастер и Маргарита", "Михаил Булгаков"),
      result("Белая гвардия", "Михаил Булгаков"),
      result("雪国", "川端康成"),
      result("古都", "川端康成"),
    ]);
    expect(merged).toHaveLength(4);
  });

  it("still merge the same title by the same author", () => {
    const merged = deduplicateResults([
      result("Мастер и Маргарита", "Михаил Булгаков"),
      result("Мастер и Маргарита", "Михаил Булгаков"),
    ]);
    expect(merged).toHaveLength(1);
  });
});
