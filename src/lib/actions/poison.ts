"use server";

import { bookCondition, requireBookWorks } from "@/lib/catalogue/book-boundary";

import { z } from "zod";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";

/** Marks or unmarks one work as poison ("Anathema" in the UI). */
export async function setPoison(workId: string, isPoison: boolean) {
  const id = z.uuid().parse(workId);
  const value = z.boolean().parse(isPoison);
  const [updated] = await db
    .update(works)
    .set({ isPoison: value, updatedAt: new Date() })
    .where(and(bookCondition, eq(works.id, id), ne(works.isPoison, value)))
    .returning({ id: works.id });
  if (!updated) {
    // Already in the wanted state, or no such book
    const found = await db.query.works.findFirst({
      where: and(bookCondition, eq(works.id, id)),
      columns: { id: true },
    });
    if (!found) throw new Error("Book not found");
    return { isPoison: value };
  }
  recordActivity("work", id, "work.poison_changed", {
    newValue: value ? "marked" : null,
  });
  invalidate(CACHE_TAGS.works, CACHE_TAGS.activity);
  return { isPoison: value };
}

/** One statement for the whole selection; unchanged books record no activity. */
export async function bulkSetPoison(workIds: string[], isPoison: boolean) {
  const ids = [...new Set(z.array(z.uuid()).min(1).max(1000).parse(workIds))];
  const value = z.boolean().parse(isPoison);
  await requireBookWorks(ids);
  const updated = await db
    .update(works)
    .set({ isPoison: value, updatedAt: new Date() })
    .where(and(bookCondition, inArray(works.id, ids), ne(works.isPoison, value)))
    .returning({ id: works.id });
  for (const { id } of updated) {
    recordActivity("work", id, "work.poison_changed", {
      newValue: value ? "marked" : null,
    });
  }
  invalidate(CACHE_TAGS.works, CACHE_TAGS.activity);
  return { updated: updated.length };
}
