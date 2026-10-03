import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { editions } from "@/lib/db/schema";

/** The IDs in `ids` that are not editions, so a route can answer 404 before it writes. */
export async function missingEditions(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const found = await db
    .select({ id: editions.id })
    .from(editions)
    .where(inArray(editions.id, ids));
  const known = new Set(found.map((row) => row.id));
  return ids.filter((id) => !known.has(id));
}
