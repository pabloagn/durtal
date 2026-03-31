"use server";

import { db } from "@/lib/db";
import { authors, countries } from "@/lib/db/schema";
import {
  and,
  asc,
  ilike,
  inArray,
  isNull,
  isNotNull,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

export interface AuthorTimelineItem {
  id: string;
  slug: string;
  name: string;
  birthYear: number;
  deathYear: number | null;
  nationality: string | null;
  posterUrl: string | null;
  posterCrop: { x: number; y: number; zoom: number } | null;
  worksCount: number;
}

export async function getAuthorsForTimeline(opts?: {
  search?: string;
  filters?: {
    nationalities?: string[];
    genders?: string[];
    zodiacSigns?: string[];
    birthYearMin?: number;
    birthYearMax?: number;
    deathYearMin?: number;
    deathYearMax?: number;
    alive?: string;
  };
}): Promise<AuthorTimelineItem[]> {
  const { search, filters } = opts ?? {};

  const conditions: SQL[] = [isNotNull(authors.birthYear)];

  if (search) {
    conditions.push(ilike(authors.name, `%${search}%`));
  }

  // Nationality filtering: resolve country names to IDs, then filter authors
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

  // Zodiac sign filtering (handles "__none__" sentinel for null values)
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

  // Alive / deceased filter ("true" | "false" string, or undefined)
  if (filters?.alive === "true") {
    conditions.push(isNull(authors.deathYear));
  } else if (filters?.alive === "false") {
    conditions.push(isNotNull(authors.deathYear));
  }

  const where = and(...conditions);

  const rows = await db.query.authors.findMany({
    where,
    orderBy: asc(authors.birthYear),
    with: {
      country: {
        columns: { name: true },
      },
      workAuthors: {
        columns: { workId: true },
      },
      media: {
        columns: {
          s3Key: true,
          thumbnailS3Key: true,
          type: true,
          isActive: true,
          cropX: true,
          cropY: true,
          cropZoom: true,
        },
      },
    },
    columns: {
      id: true,
      name: true,
      slug: true,
      birthYear: true,
      deathYear: true,
    },
  });

  const items: AuthorTimelineItem[] = [];

  for (const row of rows) {
    // birthYear is guaranteed non-null by the WHERE condition
    const birthYear = row.birthYear!;

    const activePoster = row.media?.find(
      (m) => m.type === "poster" && m.isActive,
    );
    const photoKey =
      activePoster?.thumbnailS3Key ?? activePoster?.s3Key ?? null;

    const posterCrop =
      activePoster != null
        ? {
            x: activePoster.cropX,
            y: activePoster.cropY,
            zoom: activePoster.cropZoom,
          }
        : null;

    items.push({
      id: row.id,
      slug: row.slug ?? "",
      name: row.name,
      birthYear,
      deathYear: row.deathYear ?? null,
      nationality: row.country?.name ?? null,
      posterUrl: photoKey
        ? `/api/s3/read?key=${encodeURIComponent(photoKey)}`
        : null,
      posterCrop,
      worksCount: row.workAuthors?.length ?? 0,
    });
  }

  return items;
}
