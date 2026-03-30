"use server";

import { db } from "@/lib/db";
import { authors, countries, places } from "@/lib/db/schema";
import {
  and,
  ilike,
  inArray,
  isNull,
  isNotNull,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { eq } from "drizzle-orm";

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

  const conditions: SQL[] = [];

  if (search) {
    conditions.push(ilike(authors.name, `%${search}%`));
  }

  // Nationality filtering
  if (filters?.nationalities?.length) {
    const countryRows = await db
      .select({ id: countries.id })
      .from(countries)
      .where(inArray(countries.name, filters.nationalities));
    const countryIds = countryRows.map((c) => c.id);
    if (countryIds.length > 0) {
      conditions.push(inArray(authors.nationalityId, countryIds));
    } else {
      return [];
    }
  }

  // Gender filtering
  if (filters?.genders?.length) {
    const validGenders = filters.genders.filter(
      (g) => g === "male" || g === "female",
    ) as ("male" | "female")[];
    if (validGenders.length > 0) {
      conditions.push(inArray(authors.gender, validGenders));
    }
  }

  // Zodiac sign filtering
  if (filters?.zodiacSigns?.length) {
    const hasNone = filters.zodiacSigns.includes("__none__");
    const realSigns = filters.zodiacSigns.filter((z) => z !== "__none__");
    if (hasNone && realSigns.length > 0) {
      conditions.push(
        sql`(${authors.zodiacSign} IS NULL OR ${authors.zodiacSign} = ANY(ARRAY[${sql.join(realSigns.map((s) => sql`${s}`), sql`, `)}]))`,
      );
    } else if (hasNone) {
      conditions.push(isNull(authors.zodiacSign));
    } else {
      conditions.push(inArray(authors.zodiacSign, realSigns));
    }
  }

  // Birth year range
  if (filters?.birthYearMin != null) {
    conditions.push(gte(authors.birthYear, filters.birthYearMin));
  }
  if (filters?.birthYearMax != null) {
    conditions.push(lte(authors.birthYear, filters.birthYearMax));
  }

  // Death year range
  if (filters?.deathYearMin != null) {
    conditions.push(gte(authors.deathYear, filters.deathYearMin));
  }
  if (filters?.deathYearMax != null) {
    conditions.push(lte(authors.deathYear, filters.deathYearMax));
  }

  // Alive / deceased filter
  if (filters?.alive === true) {
    conditions.push(isNull(authors.deathYear));
  } else if (filters?.alive === false) {
    conditions.push(isNotNull(authors.deathYear));
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
    });
  }

  return points;
}
