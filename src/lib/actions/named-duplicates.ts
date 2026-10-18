"use server";

import { z } from "zod";
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  works,
  authors,
  publishingHouses,
  series,
  collections,
} from "@/lib/db/schema";

const kinds = [
  "film",
  "perfume",
  "painting",
  "publisher",
  "person",
  "organization",
  "series",
  "collection",
] as const;
export type NamedKind = (typeof kinds)[number];
const inputSchema = z.object({
  kind: z.enum(kinds),
  name: z.string().trim().max(500),
  excludeId: z.uuid().optional(),
});

/** A small, advisory exact-name lookup. It never reserves or merges a record. */
export async function findNamedDuplicates(input: z.input<typeof inputSchema>) {
  const { kind, name, excludeId } = inputSchema.parse(input);
  if (!name) return [];
  let rows: { id: string; name: string; slug: string | null }[];
  if (kind === "film" || kind === "perfume" || kind === "painting") {
    rows = await db
      .select({ id: works.id, name: works.title, slug: works.slug })
      .from(works)
      .where(
        and(
          eq(works.kind, kind),
          sql`search_normalize(${works.title})=search_normalize(${name})`,
          excludeId ? ne(works.id, excludeId) : undefined,
        ),
      )
      .orderBy(asc(works.title), asc(works.id))
      .limit(3);
  } else if (kind === "person") {
    rows = await db
      .select({ id: authors.id, name: authors.name, slug: authors.slug })
      .from(authors)
      .where(
        and(
          sql`search_normalize(${authors.name})=search_normalize(${name})`,
          excludeId ? ne(authors.id, excludeId) : undefined,
        ),
      )
      .orderBy(asc(authors.name), asc(authors.id))
      .limit(3);
  } else if (kind === "publisher" || kind === "organization") {
    rows = await db
      .select({
        id: publishingHouses.id,
        name: publishingHouses.name,
        slug: publishingHouses.slug,
      })
      .from(publishingHouses)
      .where(
        and(
          sql`search_normalize(${publishingHouses.name})=search_normalize(${name})`,
          kind === "publisher" ? isNotNull(publishingHouses.kind) : undefined,
          excludeId ? ne(publishingHouses.id, excludeId) : undefined,
        ),
      )
      .orderBy(asc(publishingHouses.name), asc(publishingHouses.id))
      .limit(3);
  } else if (kind === "series") {
    rows = await db
      .select({ id: series.id, name: series.title, slug: series.slug })
      .from(series)
      .where(
        and(
          sql`search_normalize(${series.title})=search_normalize(${name})`,
          excludeId ? ne(series.id, excludeId) : undefined,
        ),
      )
      .orderBy(asc(series.title), asc(series.id))
      .limit(3);
  } else {
    rows = (
      await db
        .select({ id: collections.id, name: collections.name })
        .from(collections)
        .where(
          and(
            sql`search_normalize(${collections.name})=search_normalize(${name})`,
            excludeId ? ne(collections.id, excludeId) : undefined,
          ),
        )
        .orderBy(asc(collections.name), asc(collections.id))
        .limit(3)
    ).map((row) => ({ ...row, slug: null }));
  }
  const base = {
    film: "films",
    perfume: "perfumes",
    painting: "paintings",
    person: "people",
    publisher: "publishers",
    organization: "organizations",
    series: "series",
    collection: "collections",
  }[kind];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    href: `/${base}/${encodeURIComponent(kind === "series" || kind === "collection" ? row.id : (row.slug ?? row.id))}`,
  }));
}
