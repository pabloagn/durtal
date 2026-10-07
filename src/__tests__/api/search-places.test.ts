import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// A made-up key: the route needs one set, and Google is stubbed below
const env = vi.hoisted(() => ({ GOOGLE_PLACES_API_KEY: "test-places-key" as string | undefined }));
vi.mock("@/lib/env", () => ({ serverEnv: () => env }));
import { POST as searchPlaces } from "@/app/api/venues/search-places/route";

// POST /api/venues/search-places (SLN-515): Google's Places API stubbed, no network

const google = vi.fn(async (url: string | URL, init?: RequestInit) => {
  // Anything but the Places endpoint would be a real request
  if (String(url) !== "https://places.googleapis.com/v1/places:searchText") throw new Error(`Unexpected request to ${url}`);
  void init;
  return Response.json({
    places: [
      {
        id: "ChIJ-shakespeare",
        displayName: { text: "Shakespeare and Company" },
        formattedAddress: "37 Rue de la Bûcherie, 75005 Paris",
        websiteUri: "https://shakespeareandcompany.com",
        location: { latitude: 48.8526, longitude: 2.3471 },
        types: ["book_store"],
      },
      // A place with no id is left out
      { displayName: { text: "No id" } },
    ],
  });
});
const search = (body: unknown) =>
  searchPlaces(new NextRequest("http://localhost/api/venues/search-places", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  google.mockClear();
  env.GOOGLE_PLACES_API_KEY = "test-places-key";
  vi.stubGlobal("fetch", google);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/venues/search-places", () => {
  it("asks the Places API for the trimmed query and type, and returns the places it can name", async () => {
    const res = await search({ query: "  Shakespeare and Company Paris ", type: "book_store" });
    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual([
      {
        placeId: "ChIJ-shakespeare",
        name: "Shakespeare and Company",
        formattedAddress: "37 Rue de la Bûcherie, 75005 Paris",
        nationalPhoneNumber: null,
        websiteUri: "https://shakespeareandcompany.com",
        location: { latitude: 48.8526, longitude: 2.3471 },
        types: ["book_store"],
        googleMapsUri: null,
      },
    ]);
    expect(google).toHaveBeenCalledTimes(1);
    const init = google.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-places-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ textQuery: "Shakespeare and Company Paris", includedType: "book_store" });
  });

  it("refuses an empty query or a body that is not JSON before asking Google", async () => {
    expect((await search({ query: "   " })).status).toBe(400);
    expect((await search({})).status).toBe(400);
    expect((await search("not json")).status).toBe(400);
    expect(google).not.toHaveBeenCalled();
  });

  it("answers 503 when no key is set, and tells a refused key from other Google errors", async () => {
    env.GOOGLE_PLACES_API_KEY = undefined;
    expect((await search({ query: "Paris" })).status).toBe(503);
    env.GOOGLE_PLACES_API_KEY = "test-places-key";
    google.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    expect((await search({ query: "Paris" })).status).toBe(503);
    google.mockResolvedValueOnce(new Response("busy", { status: 500 }));
    expect((await search({ query: "Paris" })).status).toBe(502);
  });
});
