"use server";

import { db } from "@/lib/db";
import { recommenders } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export async function getRecommenders() {
  return db.select().from(recommenders).orderBy(asc(recommenders.name));
}
