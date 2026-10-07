"use server";

import { bookPersonCondition } from "@/lib/catalogue/person-boundary";

import { db } from "@/lib/db";
import { getPersonWorkCounts } from "@/lib/actions/authors";
import { authors } from "@/lib/db/schema";
import { and, asc, isNotNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { buildAuthorFilterConditions } from "@/lib/actions/utils/author-filters";
import { authorSearchCondition } from "@/lib/actions/utils/author-search";
import { mediaCrop, type MediaCrop } from "@/lib/utils/media-style";
import { countryDisplayName } from "@/lib/utils/labels";
import { mediaUrl } from "@/lib/s3/media-url";

export interface AuthorTimelineItem {
  id: string;
  slug: string;
  name: string;
  birthYear: number;
  deathYear: number | null;
  nationality: string | null;
  posterUrl: string | null;
  posterCrop: MediaCrop | null;
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
    collections?: string[];
    roles?: string[];
    favourites?: boolean;
  };
}): Promise<AuthorTimelineItem[]> {
  const { search, filters } = opts ?? {};

  const filterConditions = await buildAuthorFilterConditions(filters);
  if (filterConditions === null) return [];

  const conditions: SQL[] = [bookPersonCondition, isNotNull(authors.birthYear), ...filterConditions];

  const searchCondition = search ? authorSearchCondition(search) : undefined;
  if (searchCondition) conditions.push(searchCondition);

  const where = and(...conditions);

  const rows = await db.query.authors.findMany({
    where,
    orderBy: asc(authors.birthYear),
    with: {
      country: {
        columns: { name: true, alpha2: true },
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
          brightness: true,
          contrast: true,
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

    const posterCrop = activePoster != null ? mediaCrop(activePoster) : null;

    items.push({
      id: row.id,
      slug: row.slug ?? "",
      name: row.name,
      birthYear,
      deathYear: row.deathYear ?? null,
      nationality: countryDisplayName(row.country),
      posterUrl: photoKey
        ? mediaUrl(photoKey)
        : null,
      posterCrop,
      worksCount: 0,
    });
  }

  // "N works" counts every collection's works, as the People table does: one
  // grouped query for the whole timeline
  const counts = await getPersonWorkCounts(items.map((item) => item.id));
  for (const item of items) item.worksCount = counts[item.id] ?? 0;

  return items;
}
