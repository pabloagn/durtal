"use server";

import { bookCondition } from "@/lib/catalogue/book-boundary";

import { readingFiltersSchema, type ReadingFilterParams } from "@/lib/reading/filter-params";
import { readingFilterConditions } from "@/lib/reading/filter-conditions";
import { db } from "@/lib/db";
import { works, editions } from "@/lib/db/schema";
import { and, eq, asc, ilike, isNotNull } from "drizzle-orm";
import { containsPattern } from "@/lib/utils/like";
import type { SQL } from "drizzle-orm";
import { mediaCrop, type MediaCrop } from "@/lib/utils/media-style";
import { bookFilterConditions } from "@/lib/library/filter-conditions";
import { bookFiltersSchema, type BookFilterParams } from "@/lib/library/filter-params";
import { z } from "zod/v4";
import { mediaUrl } from "@/lib/s3/media-url";

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
  coverCrop: MediaCrop | null;
  catalogueStatus: string;
  rating: number | null;
  editions: WorkEditionTimelineItem[];
}

export async function getWorksForTimeline(opts?: {
  search?: string;
  filters?: ReadingFilterParams &
    BookFilterParams & {
      isRare?: boolean;
      isPoison?: boolean;
    };
}): Promise<WorkTimelineItem[]> {
  const { search, filters } = opts ?? {};
  // The browser sends the page's parsed filters back: check them again
  const reading = filters ? readingFiltersSchema.parse(filters) : undefined;
  const book = filters ? bookFiltersSchema.parse(filters) : undefined;
  const flags = z.object({ isRare: z.boolean().optional(), isPoison: z.boolean().optional() }).parse(filters ?? {});

  const conditions: SQL[] = [bookCondition, isNotNull(works.originalYear)];

  if (search) {
    conditions.push(ilike(works.title, containsPattern(search)));
  }

  if (flags.isRare !== undefined) conditions.push(eq(works.isRare, flags.isRare));
  if (flags.isPoison !== undefined) conditions.push(eq(works.isPoison, flags.isPoison));
  // The list's conditions: marks, publishers, copies, languages, taxonomy, colour (SLN-405)
  conditions.push(...bookFilterConditions(book));
  // Status, reading state, holding, read in, re-read (SLN-449)
  conditions.push(...readingFilterConditions(works.id, reading));

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
          brightness: true,
          contrast: true,
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

    const coverCrop = activePoster != null ? mediaCrop(activePoster) : null;

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
        ? mediaUrl(coverKey)
        : null,
      coverCrop,
      catalogueStatus: row.catalogueStatus,
      rating: row.rating ?? null,
      editions: editionItems,
    });
  }

  return items;
}
