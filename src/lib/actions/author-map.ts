"use server";

import { db } from "@/lib/db";
import { authors } from "@/lib/db/schema";
import { and, ilike } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { buildAuthorFilterConditions } from "@/lib/actions/utils/author-filters";

export interface AuthorMapPoint {
  id: string;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
  locationName: string;
  posterUrl: string | null;
  birthYear: number | null;
  deathYear: number | null;
  /** ISO 3166-1 alpha-2 code of the author's nationality */
  nationalityCode: string | null;
  nationalityName: string | null;
}

export async function getAuthorsForMap(opts?: {
  search?: string;
  filters?: {
    nationalities?: string[];
    genders?: string[];
    zodiacSigns?: string[];
    birthYearMin?: number;
    birthYearMax?: number;
    deathYearMin?: number;
    deathYearMax?: number;
    alive?: boolean;
  };
}): Promise<AuthorMapPoint[]> {
  const { search, filters } = opts ?? {};

  const filterConditions = await buildAuthorFilterConditions(filters);
  if (filterConditions === null) return [];

  const conditions: SQL[] = [...filterConditions];

  if (search) {
    conditions.push(ilike(authors.name, `%${search}%`));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch all matching authors with birthPlace and country coordinates
  const rows = await db.query.authors.findMany({
    where,
    with: {
      birthPlace: {
        columns: {
          name: true,
          fullName: true,
          latitude: true,
          longitude: true,
        },
      },
      country: {
        columns: {
          name: true,
          alpha2: true,
          latitude: true,
          longitude: true,
        },
      },
      media: {
        columns: {
          s3Key: true,
          thumbnailS3Key: true,
          type: true,
          isActive: true,
        },
      },
    },
    columns: {
      id: true,
      name: true,
      slug: true,
      birthYear: true,
      deathYear: true,
      nationalityId: true,
      birthPlaceId: true,
    },
  });

  const points: AuthorMapPoint[] = [];

  for (const row of rows) {
    let latitude: number | null = null;
    let longitude: number | null = null;
    let locationName: string = "";

    // Priority 1: birthPlace coordinates
    if (
      row.birthPlace &&
      row.birthPlace.latitude != null &&
      row.birthPlace.longitude != null
    ) {
      latitude = row.birthPlace.latitude;
      longitude = row.birthPlace.longitude;
      locationName = row.birthPlace.fullName ?? row.birthPlace.name;
    }
    // Priority 2: nationality country centroid
    else if (
      row.country &&
      row.country.latitude != null &&
      row.country.longitude != null
    ) {
      latitude = row.country.latitude;
      longitude = row.country.longitude;
      locationName = row.country.name;
    }

    // Skip authors with no coordinates at all
    if (latitude == null || longitude == null) continue;

    const activePoster = row.media?.find(
      (m) => m.type === "poster" && m.isActive,
    );
    const photoKey =
      activePoster?.thumbnailS3Key ?? activePoster?.s3Key ?? null;

    points.push({
      id: row.id,
      name: row.name,
      slug: row.slug ?? "",
      latitude,
      longitude,
      locationName,
      posterUrl: photoKey
        ? `/api/s3/read?key=${encodeURIComponent(photoKey)}`
        : null,
      birthYear: row.birthYear ?? null,
      deathYear: row.deathYear ?? null,
      nationalityCode: row.country?.alpha2 ?? null,
      nationalityName: row.country?.name ?? null,
    });
  }

  return points;
}
