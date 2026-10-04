"use server";
import { z } from "zod/v4";
import { and, eq, isNull, asc, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { perfumeRetailerLinks as links, perfumeRetailerObservations as observations, publishingHouses, venues } from "@/lib/db/schema";
import { retailerLinkSchema, retailerObservationSchema, retailerObservationAge, type RetailerLinkInput, type RetailerObservationInput } from "@/lib/catalogue/retailers";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { organizationRoleQueries } from "@/lib/catalogue/work-store";

function changed() { invalidate(CACHE_TAGS.works, CACHE_TAGS.venues); }
/** The organization that sells it becomes a retailer in the same write, if it is not one yet. */
export async function addPerfumeRetailerLink(input: RetailerLinkInput) {
  const values = retailerLinkSchema.parse(input);
  const results = await withReadableErrors(() => atomic((d) => [
    ...organizationRoleQueries(d, [{ organizationId: values.organizationId, role: "retailer" }]),
    d.insert(links).values(values).returning(),
  ]), { unique: "This retailer already lists this perfume at this address" });
  const [link] = results[results.length - 1] as (typeof links.$inferSelect)[];
  changed(); return link;
}
export async function recordRetailerObservation(input: RetailerObservationInput) {
  const parsed = retailerObservationSchema.parse(input);
  const [observation] = await withReadableErrors(() => db.insert(observations).values({ ...parsed, checkedAt: new Date(parsed.checkedAt) }).returning());
  changed(); return observation;
}
export async function archivePerfumeRetailerLink(id: string, archived = true) {
  z.uuid().parse(id); z.boolean().parse(archived);
  const [row] = await db.update(links).set({ archivedAt: archived ? new Date() : null }).where(eq(links.id, id)).returning({ id: links.id });
  if (!row) throw new Error("Retailer link not found");
  changed(); return row;
}
export async function deletePerfumeRetailerLink(id: string) {
  z.uuid().parse(id);
  const [row] = await withReadableErrors(
    () => db.delete(links).where(eq(links.id, id)).returning({ id: links.id }),
    { reference: "This listing has recorded prices, which stay as history; archive it instead" },
  );
  if (!row) throw new Error("Retailer link not found");
  changed(); return row;
}
const querySchema = z.strictObject({
  workId: z.uuid(), variantId: z.uuid().optional(), includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).max(1000000).default(0),
  staleAfterDays: z.number().int().min(1).max(3650).default(30),
});
export async function getPerfumeRetailerLinks(input: z.input<typeof querySchema>) {
  const q = querySchema.parse(input);
  // One lateral lookup per returned link; no per-row round trips or unbounded history loading.
  const latest = db.select().from(observations).where(eq(observations.linkId, links.id))
    .orderBy(desc(observations.checkedAt), desc(observations.recordedAt), asc(observations.id)).limit(1).as("latest");
  const rows = await db.select({ link: links, retailerName: publishingHouses.name, venueName: venues.name, observation: { id: latest.id, checkedAt: latest.checkedAt, recordedAt: latest.recordedAt, availability: latest.availability, price: latest.price, currency: latest.currency, container: latest.container, capacityMl: latest.capacityMl, packageLabel: latest.packageLabel, sourceRecordId: latest.sourceRecordId, notes: latest.notes } })
    .from(links).innerJoin(publishingHouses, eq(links.organizationId, publishingHouses.id))
    .leftJoin(venues, eq(links.venueId, venues.id)).leftJoinLateral(latest, sql`true`)
    .where(and(eq(links.workId, q.workId), q.variantId ? eq(links.variantId, q.variantId) : undefined, q.includeArchived ? undefined : isNull(links.archivedAt)))
    .orderBy(asc(publishingHouses.name), asc(links.id)).limit(q.limit).offset(q.offset);
  const now = new Date();
  return rows.map(row => ({ ...row, lastCheckedAt: row.observation?.checkedAt ?? null, ...retailerObservationAge(row.observation?.checkedAt ?? null, now, q.staleAfterDays) }));
}
export async function getRetailerObservationHistory(linkId: string, input: { limit?: number; offset?: number } = {}) {
  z.uuid().parse(linkId);
  const q = z.strictObject({ limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).max(1000000).default(0) }).parse(input);
  return db.select().from(observations).where(eq(observations.linkId, linkId))
    .orderBy(desc(observations.checkedAt), desc(observations.recordedAt), asc(observations.id)).limit(q.limit).offset(q.offset);
}
