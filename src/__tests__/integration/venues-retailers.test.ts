import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
const url = process.env.DURTAL_VENUES_RETAILERS_TEST_DATABASE_URL;
if (url) { const p = new URL(url); if (!["localhost", "127.0.0.1"].includes(p.hostname) || p.pathname !== "/sln351_test") throw new Error("Venue tests require disposable local sln351_test"); }
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_, key) => { if (!testDb) throw new Error("Local database required"); return Reflect.get(testDb, key); } }) }));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), CACHE_TAGS: {} }));
const cleanup = vi.hoisted(() => ({ deleteUnusedObjects: vi.fn(async () => false) }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: cleanup.deleteUnusedObjects,
}));
import { createVenue, updateVenue, deleteVenue, archiveVenue, getVenue, getVenueBySlug, getVenues, getVenueCount, searchVenues } from "@/lib/actions/venues";
import { saveOrganization, linkOrganizationVenue, unlinkOrganizationVenue, mergeOrganizations, getOrganizationMergePreview } from "@/lib/actions/organizations";
import { previewMerge, executeMerge } from "@/lib/harmonization/merge";
import { recordSourceObservation } from "@/lib/actions/catalogue-provenance";
import { addPerfumeRetailerLink, recordRetailerObservation, archivePerfumeRetailerLink, deletePerfumeRetailerLink, getPerfumeRetailerLinks, getRetailerObservationHistory } from "@/lib/actions/perfume-retailers";

describe.skipIf(!url)("venues and dated retailer observations", () => {
  const c = client!;
  let workId: string, otherId: string, variantId: string, organizationId: string;
  beforeAll(async () => { await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" }); await c`alter table works drop constraint works_kind_enabled_check`; }, 30000);
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    await c`truncate works, publishing_houses, venues, places, harmonization_operations, harmonization_redirects cascade`;
    const rows = await c`insert into works(title,kind,original_language) values ('Fragrance','perfume',null),('Other','perfume',null) returning id`;
    [workId, otherId] = rows.map(r => r.id);
    await c`insert into perfume_details(work_id) values (${workId}),(${otherId})`;
    const [variant] = await c`insert into perfume_variants(work_id) values (${workId}) returning id`; variantId = variant.id;
    organizationId = (await saveOrganization({ name: "Retailer", roles: ["retailer"] }))!.id;
  });
  const link = () => addPerfumeRetailerLink({ workId, variantId, organizationId, url: "https://retailer.example/fragrance" });
  it("creates online establishments without invented places and distinct concurrent names", async () => {
    const rows = await Promise.all([createVenue({ name: "Online shop", type: "online_store" }), createVenue({ name: "Online shop", type: "online_store" })]);
    expect(new Set(rows.map(r => r.slug)).size).toBe(2);
    expect(rows.every(r => r.placeId === null)).toBe(true);
    expect(await c`select id from places`).toHaveLength(0);
  });
  it("keeps multiple museum and retailer branches separate from geography and storage", async () => {
    const museum = (await saveOrganization({ name: "Museum", roles: ["museum"] }))!;
    for (const name of ["North gallery", "South gallery"]) {
      const venue = await createVenue({ name, type: "gallery", placeCoordinates: { latitude: 52, longitude: 4 }, formattedAddress: name });
      await linkOrganizationVenue({ organizationId: museum.id, venueId: venue.id });
      expect((await getVenue(venue.id))?.place?.type).toBe("address");
    }
    expect(await getVenueCount({ filters: { organizationId: museum.id } })).toBe(2);
    expect(await c`select id from locations`).toHaveLength(0);
  });
  it("rolls back geographic point creation if the venue write fails", async () => {
    await c.unsafe(`create function reject_test_venue() returns trigger language plpgsql as $$ begin raise exception 'Injected failure'; end $$; create trigger reject_test_venue before insert on venues for each row execute function reject_test_venue()`);
    try { await expect(createVenue({ name: "Failure", type: "perfumery", placeCoordinates: { latitude: 52, longitude: 4 } })).rejects.toThrow(); }
    finally { await c.unsafe("drop trigger reject_test_venue on venues; drop function reject_test_venue()"); }
    expect(await c`select id from places`).toHaveLength(0);
  });
  it("preserves URLs on rename and validates sparse edits against stored dates", async () => {
    const venue = await createVenue({ name: "Original", type: "cinema", firstVisitDate: "2026-04-10" });
    await updateVenue(venue.id, { name: "Renamed" });
    expect((await getVenueBySlug(venue.slug!))?.name).toBe("Renamed");
    await expect(updateVenue(venue.id, { lastVisitDate: "2026-04-09" })).rejects.toThrow();
    await expect(updateVenue(venue.id, { name: " " })).rejects.toThrow();
    await expect(updateVenue(randomUUID(), { name: "Absent" })).rejects.toThrow();
  });
  it("uses the same normalized search and filters for results and counts", async () => {
    await createVenue({ name: "Parfumerie Étoile", type: "perfumery", isFavorite: true, tags: ["niche"] });
    await createVenue({ name: "Étoile Films", type: "cinema" });
    const opts = { search: "etoile", filters: { types: ["perfumery" as const], favorite: true, tags: ["niche"] } };
    expect(await getVenueCount(opts)).toBe(1);
    expect(await getVenues(opts)).toHaveLength(1);
    expect(await searchVenues("etoile")).toHaveLength(2);
    await expect(getVenues({ limit: 10000 })).rejects.toThrow();
    await expect(getVenues({ offset: -1 })).rejects.toThrow();
  });
  it("archives referenced venues without losing order or source history", async () => {
    const venue = await createVenue({ name: "Historic bookshop", type: "bookshop" });
    const [book] = await c`insert into works(title) values ('Book') returning id`;
    await c`insert into orders(work_id,venue_id,acquisition_method,order_date) values (${book.id},${venue.id},'online_order','2026-09-01')`;
    await expect(deleteVenue(venue.id)).rejects.toThrow();
    await archiveVenue(venue.id);
    expect(await getVenueCount()).toBe(0);
    expect(await getVenueCount({ filters: { archived: "only" } })).toBe(1);
    expect((await getVenueBySlug(venue.slug!))?.archivedAt).toBeInstanceOf(Date);
    expect((await c`select venue_id from orders`)[0].venue_id).toBe(venue.id);
    await archiveVenue(venue.id, false);
    expect(await getVenueCount()).toBe(1);
  });
  it("blocks deletion of documented venues and removes an unused venue's images", async () => {
    const venue = await createVenue({ name: "Documented museum", type: "museum" });
    await recordSourceObservation({ owner: { kind: "venue", id: venue.id }, provider: "manual", retrievedAt: new Date(), payload: {} });
    await expect(deleteVenue(venue.id)).rejects.toThrow();
    expect(cleanup.deleteUnusedObjects).not.toHaveBeenCalled();
    const art = await createVenue({ name: "With artwork", type: "gallery", posterS3Key: "gold/venue/test.webp" });
    expect(await deleteVenue(art.id)).toEqual({ id: art.id, cleanupPending: false });
    // Its images, and the folder of its comment files (SLN-372)
    expect(cleanup.deleteUnusedObjects).toHaveBeenCalledWith(
      { keys: ["gold/venue/test.webp"], prefixes: [`gold/comments/venue/${art.id}/`] },
      `venue ${art.id}`,
    );
    const unused = await createVenue({ name: "Unused", type: "other" });
    await deleteVenue(unused.id); expect(await getVenue(unused.id)).toBeUndefined();
  });
  it("requires the matching fragrance, retailer role and operated branch", async () => {
    await expect(addPerfumeRetailerLink({ workId: otherId, variantId, organizationId, url: "https://retailer.example/wrong" })).rejects.toThrow();
    const venue = await createVenue({ name: "Branch", type: "perfumery" });
    const input = { workId, organizationId, venueId: venue.id, url: "https://retailer.example/branch" };
    await expect(addPerfumeRetailerLink(input)).rejects.toThrow();
    await linkOrganizationVenue({ organizationId, venueId: venue.id });
    await addPerfumeRetailerLink(input);
    await expect(unlinkOrganizationVenue({ organizationId, venueId: venue.id, role: "operator" })).rejects.toThrow();
    await expect(saveOrganization({ name: "Retailer", roles: ["brand"] }, organizationId)).rejects.toThrow();
    await saveOrganization({ name: "Retailer", roles: ["retailer", "brand"] }, organizationId);
  });
  it("retains observation history and derives last checked from observed time, not insertion order", async () => {
    const listing = await link();
    const latest = await recordRetailerObservation({ linkId: listing.id, checkedAt: "2024-06-01T12:00:00Z", availability: "out_of_stock", price: 150, currency: "EUR", container: "bottle", capacityMl: 100 });
    await recordRetailerObservation({ linkId: listing.id, checkedAt: "2024-01-01T12:00:00Z", availability: "in_stock", price: 5, currency: "EUR", container: "sample", capacityMl: 2 });
    const [result] = await getPerfumeRetailerLinks({ workId });
    expect(result.observation?.id).toBe(latest.id);
    expect(result.observation).toMatchObject({ availability: "out_of_stock", capacityMl: 100, price: 150, currency: "EUR" });
    expect(result.lastCheckedAt?.toISOString()).toBe("2024-06-01T12:00:00.000Z");
    expect(result.isStale).toBe(true);
    expect(await getRetailerObservationHistory(listing.id)).toHaveLength(2);
    expect(await getRetailerObservationHistory(listing.id, { limit: 1, offset: 1 })).toHaveLength(1);
    await expect(c`update perfume_retailer_observations set availability='in_stock' where id=${latest.id}`).rejects.toThrow("append-only");
    await expect(c`delete from perfume_retailer_observations where id=${latest.id}`).rejects.toThrow("append-only");
    await expect(deletePerfumeRetailerLink(listing.id)).rejects.toThrow();
  });
  it("supports unobserved links and explicit archive/restore without losing observations", async () => {
    const listing = await link();
    expect((await getPerfumeRetailerLinks({ workId }))[0]).toMatchObject({ observation: null, lastCheckedAt: null, ageDays: null, isStale: true });
    await archivePerfumeRetailerLink(listing.id);
    expect(await getPerfumeRetailerLinks({ workId })).toHaveLength(0);
    await expect(recordRetailerObservation({ linkId: listing.id, checkedAt: new Date().toISOString() })).rejects.toThrow();
    await archivePerfumeRetailerLink(listing.id, false);
    await recordRetailerObservation({ linkId: listing.id, checkedAt: new Date().toISOString() });
    expect((await getPerfumeRetailerLinks({ workId }))[0].isStale).toBe(false);
  });
  it("protects listing identity and rejects unrelated sources and future observations", async () => {
    const listing = await link();
    await expect(c`update perfume_retailer_links set url='https://retailer.example/new' where id=${listing.id}`).rejects.toThrow("immutable");
    const source = await recordSourceObservation({ owner: { kind: "perfume", id: otherId }, provider: "manual", retrievedAt: new Date(), payload: {} });
    await expect(recordRetailerObservation({ linkId: listing.id, checkedAt: new Date().toISOString(), sourceRecordId: source.id })).rejects.toThrow();
    await expect(recordRetailerObservation({ linkId: listing.id, checkedAt: "2999-01-01T00:00:00Z" })).rejects.toThrow();
    await expect(recordRetailerObservation({ linkId: listing.id, checkedAt: new Date().toISOString(), price: 10 })).rejects.toThrow();
  });
  it("preserves venue provenance, artwork and retailer history through an audited merge", async () => {
    const source = await createVenue({ name: "Duplicate branch", type: "perfumery", posterS3Key: "gold/venue/test.webp" });
    const target = await createVenue({ name: "Canonical branch", type: "perfumery" });
    await linkOrganizationVenue({ organizationId, venueId: source.id });
    await recordSourceObservation({ owner: { kind: "venue", id: source.id }, provider: "manual", retrievedAt: new Date(), payload: {} });
    const listing = await addPerfumeRetailerLink({ workId, organizationId, venueId: source.id, url: "https://retailer.example/branch" });
    await recordRetailerObservation({ linkId: listing.id, checkedAt: new Date().toISOString() });
    const preview = await previewMerge("venues", source.id, target.id);
    await executeMerge({ entity: "venues", sourceId: source.id, targetId: target.id, fingerprint: preview.fingerprint, choices: { name: "target" } });
    expect((await getVenue(target.id))?.slug).toBe(target.slug);
    expect(await getVenue(source.id)).toBeUndefined();
    expect((await getVenue(target.id))?.posterS3Key).toBe(source.posterS3Key);
    expect((await c`select venue_id from source_records where entity_kind='venue'`)[0].venue_id).toBe(target.id);
    const [result] = await getPerfumeRetailerLinks({ workId });
    expect(result.link.venueId).toBe(target.id);
    expect(result.observation).not.toBeNull();
  });
  it("preserves retailer links through an audited organization merge", async () => {
    const listing = await link();
    await recordRetailerObservation({ linkId: listing.id, checkedAt: new Date().toISOString() });
    const target = (await saveOrganization({ name: "Canonical retailer", roles: ["retailer"] }))!;
    const preview = await getOrganizationMergePreview(organizationId, target.id);
    await mergeOrganizations({ sourceId: organizationId, targetId: target.id, fingerprint: preview.fingerprint, choices: { name: "target" } });
    const [result] = await getPerfumeRetailerLinks({ workId });
    expect(result.link.id).toBe(listing.id);
    expect(result.link.organizationId).toBe(target.id);
    expect(result.observation).not.toBeNull();
  });
});
