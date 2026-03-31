"use server";

import { db } from "@/lib/db";
import { works, editions, instances, media } from "@/lib/db/schema";
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  gte,
  notInArray,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

type CatalogueStatus = (typeof works.catalogueStatus.enumValues)[number];

export interface WorkEditionTimelineItem {
  id: string;
  publicationYear: number | null;
  publisher: string | null;
  language: string;
}

export interface WorkTimelineItem {
  id: string;
  slug: string;
  title: string;
  originalYear: number;
  authorName: string;
  coverUrl: string | null;
  coverCrop: { x: number; y: number; zoom: number } | null;
  catalogueStatus: string;
  rating: number | null;
  editions: WorkEditionTimelineItem[];
}

export async function getWorksForTimeline(opts?: {
  search?: string;
  filters?: {
    catalogueStatus?: string[];
    language?: string[];
  };
}): Promise<WorkTimelineItem[]> {
  const { search, filters } = opts ?? {};

  const conditions: SQL[] = [isNotNull(works.originalYear)];

  if (search) {
    conditions.push(ilike(works.title, `%${search}%`));
  }

  if (filters?.catalogueStatus?.length) {
    conditions.push(
      inArray(
        works.catalogueStatus,
        filters.catalogueStatus as CatalogueStatus[],
      ),
    );
  }

  // Language filter: find works that have at least one edition in the requested
  // language(s), then restrict the work IDs accordingly.
  if (filters?.language?.length) {
    const matchingEditions = await db
      .select({ workId: editions.workId })
      .from(editions)
      .where(inArray(editions.language, filters.language));
    const workIds = [...new Set(matchingEditions.map((r) => r.workId))];
    if (workIds.length > 0) {
      conditions.push(inArray(works.id, workIds));
    } else {
      return [];
    }
  }

  const where = and(...conditions);

  const { workAuthors } = await import("@/lib/db/schema");

  const rows = await db.query.works.findMany({
    where,
    orderBy: asc(works.originalYear),
    with: {
      workAuthors: {
        with: {
          author: {
            columns: { name: true },
          },
        },
        orderBy: asc(workAuthors.sortOrder),
        limit: 1,
      },
      editions: {
        columns: {
          id: true,
          publicationYear: true,
          publisher: true,
          language: true,
        },
        orderBy: asc(editions.publicationYear),
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
      slug: true,
      title: true,
      originalYear: true,
      catalogueStatus: true,
      rating: true,
    },
  });

  const items: WorkTimelineItem[] = [];

  for (const row of rows) {
    // originalYear is guaranteed non-null by the WHERE condition
    const originalYear = row.originalYear!;

    const activePoster = row.media?.find(
      (m) => m.type === "poster" && m.isActive,
    );
    const coverKey =
      activePoster?.thumbnailS3Key ?? activePoster?.s3Key ?? null;

    const coverCrop =
      activePoster != null
        ? {
            x: activePoster.cropX,
            y: activePoster.cropY,
            zoom: activePoster.cropZoom,
          }
        : null;

    const authorName = row.workAuthors[0]?.author?.name ?? "";

    const editionItems: WorkEditionTimelineItem[] = row.editions.map((e) => ({
      id: e.id,
      publicationYear: e.publicationYear ?? null,
      publisher: e.publisher ?? null,
      language: e.language,
    }));

    items.push({
      id: row.id,
      slug: row.slug ?? "",
      title: row.title,
      originalYear,
      authorName,
      coverUrl: coverKey
        ? `/api/s3/read?key=${encodeURIComponent(coverKey)}`
        : null,
      coverCrop,
      catalogueStatus: row.catalogueStatus,
      rating: row.rating ?? null,
      editions: editionItems,
    });
  }

  return items;
}
