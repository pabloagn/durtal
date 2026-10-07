import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Where the Google Books quota shows (SLN-425): the notices of the search
 * and Match routes, and the settings integrations page.
 */
vi.mock("@/lib/api/search-engine", () => ({
  searchBooks: vi.fn(async () => []),
  searchNotices: vi.fn(() => ["Google Books is over its quota."]),
}));
// The overview counts rows; these tests need no database
vi.mock("@/lib/db", () => {
  const rows = Promise.resolve([{ records: 0, last: null, books: 0, linked: 0 }]);
  const where = () => Object.assign(rows, { groupBy: () => rows });
  const from = () => Object.assign(rows, { where });
  return { db: { select: () => ({ from }), execute: async () => [] } };
});
vi.mock("@/lib/s3/client", () => ({ s3: {}, S3_BUCKET: "test-bucket" }));

import { GET as searchRoute } from "@/app/api/search/route";
import { GET as matchRoute } from "@/app/api/match/route";
import {
  googleBooksFetch,
  resetGoogleBooksQuota,
} from "@/lib/api/google-books-quota";
import { integrationsOverview, runIntegrationCheck } from "@/lib/settings/integrations";

const fetchMock = vi.fn<typeof fetch>();
const URL_ = "https://www.googleapis.com/books/v1/volumes?q=x";

beforeEach(() => {
  resetGoogleBooksQuota();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  resetGoogleBooksQuota();
});

/** Google Books refused every try: the quota pauses */
async function overQuota() {
  vi.useFakeTimers();
  fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));
  const call = googleBooksFetch(URL_).catch(() => undefined);
  await vi.runAllTimersAsync();
  await call;
  vi.useRealTimers();
  fetchMock.mockReset();
}

const facts = async () =>
  (await integrationsOverview()).services.find((s) => s.id === "googleBooks")!.facts;

describe("the search routes", () => {
  it("/api/search returns the notices with the results", async () => {
    const res = await searchRoute(new NextRequest("http://localhost/api/search?q=Lanark"));
    expect(await res.json()).toEqual({ results: [], notices: ["Google Books is over its quota."] });
  });

  it("/api/match returns the notices with the results", async () => {
    const res = await matchRoute(new NextRequest("http://localhost/api/match?q=Lanark"));
    expect(await res.json()).toEqual({ results: [], notices: ["Google Books is over its quota."] });
  });
});

describe("the settings integrations page", () => {
  it("says when no Google Books call was made", async () => {
    expect(await facts()).toEqual([
      { label: "Last search call", value: "None since the app started" },
    ]);
  });

  it("shows the last call over the quota, and the pause", async () => {
    await overQuota();
    expect((await facts())[0].value).toMatch(
      /^Over the quota at \d\d:\d\d UTC; paused before the next try$/,
    );
  });

  it("the check makes no call while the quota pauses, and says so", async () => {
    await overQuota();
    expect(await runIntegrationCheck("googleBooks")).toMatchObject({
      status: "warning",
      message: "Over the quota",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the check counts as the last call", async () => {
    fetchMock.mockImplementation(async () => Response.json({ items: [] }));
    expect((await runIntegrationCheck("googleBooks")).status).toBe("ok");
    expect((await facts())[0].value).toMatch(/^Worked at \d\d:\d\d UTC$/);
  });
});
