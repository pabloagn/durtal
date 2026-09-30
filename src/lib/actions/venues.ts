"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { venues, places } from "@/lib/db/schema";
import { eq, and, asc, inArray, count, sql, isNull, isNotNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { slugify } from "@/lib/utils/slugify";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { createVenueSchema, updateVenueSchema, venueSearchSchema, type CreateVenueInput } from "@/lib/validations/venues";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { textSearchCondition } from "./utils/text-search";
export type { VenueType } from "@/lib/catalogue/venues";
export type { CreateVenueInput } from "@/lib/validations/venues";

type SearchInput = z.input<typeof venueSearchSchema>;
function venueWhere({ search, filters }: z.output<typeof venueSearchSchema>) {
  const conditions: (SQL | undefined)[] = [
    filters?.archived === "include" ? undefined : filters?.archived === "only" ? isNotNull(venues.archivedAt) : isNull(venues.archivedAt),
    search ? textSearchCondition(sql`${venues.searchText}`, search) : undefined,
    filters?.types?.length ? inArray(venues.type, filters.types) : undefined,
    filters?.favorite !== undefined ? eq(venues.isFavorite, filters.favorite) : undefined,
    filters?.organizationId ? sql`exists(select 1 from organization_venues ov where ov.venue_id=${venues.id} and ov.organization_id=${filters.organizationId}::uuid)` : undefined,
  ];
  if (filters?.tags?.length) conditions.push(sql`${venues.tags} && ARRAY[${sql.join(filters.tags.map(t => sql`${t}`), sql`, `)}]::text[]`);
  return and(...conditions);
}
export async function getVenues(input: SearchInput = {}) {
  const opts = venueSearchSchema.parse(input);
  const column = opts.sort === "recent" ? venues.createdAt : opts.sort === "rating" ? venues.personalRating : venues.name;
  const direction = opts.order ?? (opts.sort === "name" ? "asc" : "desc");
  return db.query.venues.findMany({
    where: venueWhere(opts),
    orderBy: [direction === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`, asc(venues.id)],
    limit: opts.limit, offset: opts.offset,
    with: { place: { columns: { id: true, name: true, fullName: true } } },
  });
}
export async function getVenueCount(input: SearchInput = {}) {
  const [result] = await db.select({ count: count() }).from(venues).where(venueWhere(venueSearchSchema.parse(input)));
  return result.count;
}
export async function getVenue(id: string) {
  z.uuid().parse(id);
  return db.query.venues.findFirst({ where: eq(venues.id, id), with: { place: true } });
}
export async function getVenueBySlug(slug: string) {
  z.string().min(1).max(1000).parse(slug);
  return db.query.venues.findFirst({ where: eq(venues.slug, slug), with: { place: true } });
}
export async function getFavoriteVenues() {
  return getVenues({ filters: { favorite: true }, limit: 200 });
}
export async function searchVenues(query: string) {
  return getVenues({ search: query, limit: 20 });
}
function changed() { invalidate(CACHE_TAGS.venues, CACHE_TAGS.places, CACHE_TAGS.orders); }
function lockVenue(d: typeof db, id: string) {
  return [
    d.execute(sql`select id from venues where id=${id}::uuid for update`),
    d.execute(assertSql(sql`exists(select 1 from venues where id=${id}::uuid)`, "Venue not found")),
  ];
}
function geographicPoint(input: Partial<CreateVenueInput>) {
  if (!input.placeCoordinates) return null;
  if (input.placeId) throw new Error("Choose an existing place or new coordinates, not both");
  return {
    id: randomUUID(), name: input.formattedAddress || input.name || "Geographic point",
    fullName: input.formattedAddress ?? null, type: "address",
    latitude: input.placeCoordinates.latitude, longitude: input.placeCoordinates.longitude,
  };
}
export async function createVenue(input: CreateVenueInput) {
  const parsed = createVenueSchema.parse(input);
  const point = geographicPoint(parsed);
  const { placeCoordinates: _coordinates, ...fields } = parsed;
  const id = randomUUID();
  const results = await atomic(d => [
    ...(point ? [d.insert(places).values(point)] : []),
    d.insert(venues).values({ ...fields, id, placeId: point?.id ?? fields.placeId, slug: `${slugify(fields.name) || "venue"}-${id}` }).returning(),
  ]);
  changed();
  return resultRows<typeof venues.$inferSelect>(results.at(-1))[0];
}
export async function updateVenue(id: string, input: Partial<CreateVenueInput>) {
  z.uuid().parse(id);
  const parsed = updateVenueSchema.parse(input);
  const point = geographicPoint(parsed);
  const { placeCoordinates: _coordinates, ...fields } = parsed;
  await atomic(d => [
    ...lockVenue(d, id),
    ...(point ? [d.insert(places).values(point)] : []),
    d.update(venues).set({ ...fields, ...(point ? { placeId: point.id } : {}), updatedAt: new Date() }).where(eq(venues.id, id)),
  ]);
  changed();
  return { id };
}
export async function archiveVenue(id: string, archived = true) {
  z.uuid().parse(id); z.boolean().parse(archived);
  await atomic(d => [...lockVenue(d, id), d.update(venues).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(eq(venues.id, id))]);
  changed(); return { id };
}
/** Historical references and artwork require archival; PostgreSQL protects direct writes too. */
export async function deleteVenue(id: string) {
  z.uuid().parse(id);
  await atomic(d => [...lockVenue(d, id), d.delete(venues).where(eq(venues.id, id))]);
  changed(); return { id };
}
