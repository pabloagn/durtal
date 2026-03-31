import { NextRequest, NextResponse } from "next/server";

const PLACES_API_BASE = "https://places.googleapis.com/v1/places:searchText";

// Fields to request from the Places API (New)
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.location",
  "places.types",
  "places.googleMapsUri",
].join(",");

export interface GooglePlaceResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  nationalPhoneNumber: string | null;
  websiteUri: string | null;
  location: { latitude: number; longitude: number } | null;
  types: string[];
  googleMapsUri: string | null;
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  googleMapsUri?: string;
}

function parsePlace(raw: RawPlace): GooglePlaceResult {
  return {
    placeId: raw.id ?? "",
    name: raw.displayName?.text ?? "",
    formattedAddress: raw.formattedAddress ?? "",
    nationalPhoneNumber: raw.nationalPhoneNumber ?? null,
    websiteUri: raw.websiteUri ?? null,
    location:
      raw.location?.latitude != null && raw.location?.longitude != null
        ? { latitude: raw.location.latitude, longitude: raw.location.longitude }
        : null,
    types: raw.types ?? [],
    googleMapsUri: raw.googleMapsUri ?? null,
  };
}

// Simple in-memory rate limiter: max 10 requests per 10 seconds
const requestLog: number[] = [];
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 10;

function isRateLimited(): boolean {
  const now = Date.now();
  // Remove entries older than the window
  while (requestLog.length > 0 && requestLog[0] < now - RATE_WINDOW_MS) {
    requestLog.shift();
  }
  if (requestLog.length >= RATE_LIMIT) return true;
  requestLog.push(now);
  return false;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Places API key not configured" },
      { status: 503 },
    );
  }

  if (isRateLimited()) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait a moment." },
      { status: 429 },
    );
  }

  let body: { query?: string; type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { query, type } = body;
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json(
      { error: "Provide a non-empty query string" },
      { status: 400 },
    );
  }

  const requestBody: Record<string, unknown> = {
    textQuery: query.trim(),
    maxResultCount: 8,
    languageCode: "en",
  };

  if (type && typeof type === "string") {
    requestBody.includedType = type;
  }

  try {
    const res = await fetch(PLACES_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[search-places] Google API error:", res.status, errorText);

      if (res.status === 400) {
        return NextResponse.json(
          { error: "Invalid search query" },
          { status: 400 },
        );
      }
      if (res.status === 403) {
        return NextResponse.json(
          { error: "Places API key invalid or quota exceeded" },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: "Places search failed" },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { places?: RawPlace[] };
    const places = (data.places ?? []).map(parsePlace).filter((p) => p.placeId);

    return NextResponse.json({ results: places });
  } catch (err) {
    console.error("[search-places] Fetch error:", err);
    return NextResponse.json(
      { error: "Failed to reach Places API" },
      { status: 502 },
    );
  }
}
