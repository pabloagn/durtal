"use server";

import { db } from "@/lib/db";
import { series, works, workAuthors } from "@/lib/db/schema";
import { eq, asc, ilike, count } from "drizzle-orm";

export async function getSeries(opts?: { search?: string }) {
  const { search } = opts ?? {};
  return db.query.series.findMany({
    where: search ? ilike(series.title, `%${search}%`) : undefined,
    orderBy: asc(series.title),
    with: {
      works: {
        columns: { id: true, seriesPosition: true, catalogueStatus: true },
        with: {
          editions: {
            columns: { id: true },
            with: {
              instances: {
                columns: { id: true },
              },
            },
          },
        },
      },
    },
  });
}

export async function getSeriesDetail(id: string) {
  return db.query.series.findFirst({
    where: eq(series.id, id),
    with: {
      works: {
        orderBy: asc(works.seriesPosition),
        with: {
          workAuthors: {
            with: { author: true },
            orderBy: asc(workAuthors.sortOrder),
            limit: 1,
          },
          editions: {
            columns: {
              id: true,
              thumbnailS3Key: true,
            },
            with: {
              instances: {
                columns: { id: true, status: true },
              },
            },
            limit: 1,
          },
        },
      },
    },
  });
}

export async function getSeriesCount(search?: string) {
  const [result] = await db
    .select({ count: count() })
    .from(series)
    .where(search ? ilike(series.title, `%${search}%`) : undefined);
  return result.count;
}
