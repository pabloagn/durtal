"use server";

import { db } from "@/lib/db";
import { recommenders } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { cached, CACHE_TAGS } from "@/lib/cache";

export const getRecommenders = cached(
  () => db.select().from(recommenders).orderBy(asc(recommenders.name)),
  ["recommenders"],
  [CACHE_TAGS.recommenders],
);
