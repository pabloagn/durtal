import { NextRequest, NextResponse } from "next/server";

const PLACES_API_BASE = "https://places.googleapis.com/v1/places";

const FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "location",
  "types",
  "googleMapsUri",
  "regularOpeningHours",
  "currentOpeningHours",
  "businessStatus",
  "rating",
  "userRatingCount",
].join(",");

export async function GET(req: NextRequest) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Places API key not configured" },
      { status: 503 },
    );
  }

  const placeId = req.nextUrl.searchParams.get("placeId");
  if (!placeId || typeof placeId !== "string" || placeId.trim().length === 0) {
    return NextResponse.json(
      { error: "Provide a ?placeId= query parameter" },
      { status: 400 },
    );
  }

  // Validate placeId format (basic safeguard — Google Place IDs are alphanumeric + underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(placeId.trim())) {
    return NextResponse.json(
      { error: "Invalid placeId format" },
      { status: 400 },
    );
  }

  try {
    const url = `${PLACES_API_BASE}/${encodeURIComponent(placeId.trim())}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[place-details] Google API error:", res.status, errorText);

      if (res.status === 404) {
        return NextResponse.json({ error: "Place not found" }, { status: 404 });
      }
      if (res.status === 403) {
        return NextResponse.json(
          { error: "Places API key invalid or quota exceeded" },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: "Place details request failed" },
        { status: 502 },
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    return NextResponse.json({ place: data });
  } catch (err) {
    console.error("[place-details] Fetch error:", err);
    return NextResponse.json(
      { error: "Failed to reach Places API" },
      { status: 502 },
    );
  }
}
