import { NextRequest, NextResponse } from "next/server";
import {
  ExternalFetchError,
  fetchOk,
  serialThrottle,
} from "@/lib/api/external-fetch";

export interface GeocodingResult {
  street: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
  latitude: number;
  longitude: number;
  displayName: string;
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "Durtal/1.0 (personal book catalogue)";

// Nominatim allows one request per second. Requests queue up, so two
// concurrent ones never fire together (SLN-299).
const nominatim = serialThrottle(1100);

/** One Nominatim call, in turn, with a time limit; a non-OK answer throws */
async function throttledJson<T>(url: string): Promise<T> {
  return nominatim(async () => {
    const res = await fetchOk(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    return (await res.json()) as T;
  });
}

function parseNominatimResult(item: Record<string, unknown>): GeocodingResult {
  const address = (item.address ?? {}) as Record<string, string>;
  return {
    street: [address.house_number, address.road].filter(Boolean).join(" ") || null,
    city: address.city || address.town || address.village || address.municipality || null,
    region: address.state || address.province || address.county || null,
    country: address.country || null,
    countryCode: address.country_code?.toUpperCase() || null,
    postalCode: address.postcode || null,
    latitude: Number(item.lat),
    longitude: Number(item.lon),
    displayName: String(item.display_name ?? ""),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get("mode");

  if (!mode || !["postal", "reverse", "search"].includes(mode)) {
    return NextResponse.json(
      { error: "Provide ?mode=postal|reverse|search" },
      { status: 400 },
    );
  }

  try {
    if (mode === "postal") {
      const country = searchParams.get("country"); // ISO alpha-2
      const postalcode = searchParams.get("postalcode");
      if (!postalcode) {
        return NextResponse.json(
          { error: "Provide ?postalcode= parameter" },
          { status: 400 },
        );
      }
      const params = new URLSearchParams({
        postalcode,
        format: "jsonv2",
        addressdetails: "1",
        limit: "1",
      });
      if (country) params.set("countrycodes", country.toLowerCase());
      const data = await throttledJson<Record<string, unknown>[]>(
        `${NOMINATIM_BASE}/search?${params}`,
      );
      if (!data.length) {
        return NextResponse.json({ results: [] });
      }
      return NextResponse.json({ results: data.map(parseNominatimResult) });
    }

    if (mode === "reverse") {
      const lat = searchParams.get("lat");
      const lon = searchParams.get("lon");
      if (!lat || !lon) {
        return NextResponse.json(
          { error: "Provide ?lat= and ?lon= parameters" },
          { status: 400 },
        );
      }
      const params = new URLSearchParams({
        lat,
        lon,
        format: "jsonv2",
        addressdetails: "1",
      });
      const data = await throttledJson<Record<string, unknown>>(
        `${NOMINATIM_BASE}/reverse?${params}`,
      );
      if (data.error) {
        return NextResponse.json({ results: [] });
      }
      return NextResponse.json({ results: [parseNominatimResult(data)] });
    }

    // mode === "search"
    const q = searchParams.get("q");
    if (!q) {
      return NextResponse.json(
        { error: "Provide ?q= parameter" },
        { status: 400 },
      );
    }
    const params = new URLSearchParams({
      q,
      format: "jsonv2",
      addressdetails: "1",
      limit: "5",
    });
    const data = await throttledJson<Record<string, unknown>[]>(
      `${NOMINATIM_BASE}/search?${params}`,
    );
    return NextResponse.json({ results: data.map(parseNominatimResult) });
  } catch (err) {
    if (err instanceof ExternalFetchError) {
      console.error("[geocode]", err.message);
      return NextResponse.json(
        {
          error: err.timedOut
            ? "The geocoding service did not answer"
            : err.status === 429
              ? "The geocoding service is busy. Try again in a moment"
              : "The geocoding service failed",
        },
        { status: err.timedOut ? 504 : err.status === 429 ? 503 : 502 },
      );
    }
    return NextResponse.json(
      { error: "Geocoding request failed" },
      { status: 500 },
    );
  }
}
