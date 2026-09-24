"use server";

import { db } from "@/lib/db";
import { authors } from "@/lib/db/schema";
import { and, asc, ilike, isNotNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { buildAuthorFilterConditions } from "@/lib/actions/utils/author-filters";

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

  const filterConditions = await buildAuthorFilterConditions(filters);
  if (filterConditions === null) return [];

  const conditions: SQL[] = [isNotNull(authors.birthYear), ...filterConditions];

  if (search) {
    conditions.push(ilike(authors.name, `%${search}%`));
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
