import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_VENUE_PAGES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln370_test")
    throw new Error("Venue page tests require disposable local sln370_test");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  cached: (fn: unknown) => fn,
  CACHE_TAGS: {},
}));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import {
  getVenueArt,
  getVenueCountries,
  getVenueInstitutions,
  getVenueOrders,
  getVenueReferences,
  getVenueRetail,
  linkVenueInstitution,
  removeVenue,
  setVenueArchived,
  unlinkVenueInstitution,
} from "@/lib/actions/venue-pages";
import { createVenue, getVenues, updateVenue, getVenueBySlug } from "@/lib/actions/venues";
import { saveOrganization } from "@/lib/actions/organizations";
import { createArtObject, createPainting } from "@/lib/actions/paintings";
import { getWhereabouts, recordWhereabouts } from "@/lib/actions/whereabouts";
import { addPerfumeRetailerLink, recordRetailerObservation } from "@/lib/actions/perfume-retailers";

describe.skipIf(!url)("venue pages", () => {
  const c = client!;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint if exists works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, venues, places, catalogue_dates, source_records, harmonization_operations, harmonization_redirects cascade`;
  });

  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error("Expected the call to fail");
      },
      (e: Error) => e.message,
    );
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });

  it("keeps a museum's collection apart from a gallery hosting its loaned-out original", async () => {
    const louvre = (await saveOrganization({ name: "Musée du Louvre", roles: ["museum"] }))!.id;
    const paris = await createVenue({ name: "Louvre, Paris", type: "museum" });
    const lens = await createVenue({ name: "Louvre-Lens", type: "museum" });
    const tokyo = await createVenue({ name: "Tokyo Gallery", type: "gallery" });
    await linkVenueInstitution({ organizationId: louvre, venueId: paris.id, role: "operator" });
    await linkVenueInstitution({ organizationId: louvre, venueId: lens.id, role: "operator" });

    const mona = await createPainting({ title: "Mona Lisa" });
    const original = await createArtObject({
      workId: mona.id,
      kind: "original",
      ownership: "institutional",
      ownerOrganizationId: louvre,
    });
    const atLouvre = await recordWhereabouts(
      { objectId: original.id, placeKind: "venue", venueId: paris.id, custody: "permanent_collection", certainty: "confirmed", startsOn: year(1797) },
      (await getWhereabouts(original.id))!.fingerprint,
    );
    // Before the loan, it is here, in the permanent collection, display not assumed
    const before = await getVenueArt(paris.id);
    expect(before.here.rows).toEqual([
      expect.objectContaining({
        title: "Mona Lisa",
        custody: "permanent_collection",
        displayStatus: "unknown",
        certainty: "confirmed",
        ownerName: "Musée du Louvre",
        since: "1797",
      }),
    ]);
    // Lent to Tokyo: the move closes the Paris record and opens a loan there
    await recordWhereabouts(
      {
        objectId: original.id,
        placeKind: "venue",
        venueId: tokyo.id,
        custody: "temporary_loan",
        certainty: "confirmed",
        occasionLabel: "Tokyo exhibition",
        startsOn: year(1974),
      },
      atLouvre.fingerprint,
    );
    const unplaced = await createPainting({ title: "The Raft" });
    await createArtObject({ workId: unplaced.id, kind: "original", ownership: "institutional", ownerOrganizationId: louvre });

    const museum = await getVenueArt(paris.id);
    expect(museum.here).toEqual({ total: 0, rows: [] });
    expect(museum.away.total).toBe(2);
    expect(museum.away.rows.map((r) => [r.title, r.venueName, r.custody, r.since])).toEqual([
      ["Mona Lisa", "Tokyo Gallery", "temporary_loan", "1974"],
      ["The Raft", null, null, null],
    ]);
    expect(museum.away.rows[1].whereaboutsId).toBeNull();

    const gallery = await getVenueArt(tokyo.id);
    expect(gallery.here.rows).toEqual([
      expect.objectContaining({
        title: "Mona Lisa",
        custody: "temporary_loan",
        ownerName: "Musée du Louvre",
        occasionLabel: "Tokyo exhibition",
        since: "1974",
      }),
    ]);
    expect(gallery.away).toEqual({ total: 0, rows: [] });

    // The institution runs both museums: each lists the other as a branch
    expect(await getVenueInstitutions(paris.id)).toEqual([
      expect.objectContaining({
        name: "Musée du Louvre",
        role: "operator",
        roles: ["museum"],
        branches: [expect.objectContaining({ name: "Louvre-Lens", type: "museum", archived: false })],
      }),
    ]);
    // Location history keeps both venues
    expect((await getVenueReferences(tokyo.id)).whereabouts).toBe(1);
    expect(await failure(removeVenue(tokyo.id))).toBe(
      "Archive a venue that appears in artwork location history instead of deleting it",
    );
  });

  it("lists an online retailer's listings without an address, with the last dated offer", async () => {
    const retailer = (await saveOrganization({ name: "Parfums en Ligne", roles: ["retailer"] }))!.id;
    const shop = await createVenue({ name: "Parfums en Ligne", type: "online_store" });
    expect(shop).toMatchObject({ placeId: null, formattedAddress: null });
    await linkVenueInstitution({ organizationId: retailer, venueId: shop.id, role: "operator" });
    const [work] = await c`insert into works(title,kind,original_language) values ('Shalimar','perfume',null) returning id`;
    await c`insert into perfume_details(work_id) values (${work.id})`;
    const [variant] =
      await c`insert into perfume_variants(work_id, concentration) values (${work.id}, 'eau_de_parfum') returning id`;
    const branch = await addPerfumeRetailerLink({
      workId: work.id,
      variantId: variant.id,
      organizationId: retailer,
      venueId: shop.id,
      url: "https://parfums.example/shalimar",
    });
    await addPerfumeRetailerLink({ workId: work.id, organizationId: retailer, url: "https://parfums.example/any" });
    await recordRetailerObservation({
      linkId: branch.id,
      checkedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      availability: "in_stock",
      price: 120,
      currency: "EUR",
    });

    const retail = await getVenueRetail(shop.id);
    expect(retail.total).toBe(2);
    expect(retail.rows.map((r) => [r.url, r.venueId, r.hasVariant, r.availability, r.price, r.currency])).toEqual([
      ["https://parfums.example/shalimar", shop.id, true, "in_stock", 120, "EUR"],
      ["https://parfums.example/any", null, false, null, null, null],
    ]);
    expect(retail.rows[0]).toMatchObject({ concentration: "eau_de_parfum", ageDays: 3, isStale: false });
    expect(retail.rows[1]).toMatchObject({ ageDays: null, isStale: true });

    // A retailer whose listings name this branch keeps running it
    expect(await failure(unlinkVenueInstitution({ organizationId: retailer, venueId: shop.id, role: "operator" }))).toBe(
      "Retailer listing history still references this operated branch",
    );
  });

  it("keeps a bookshop's orders, archives it instead of deleting, and deletes an unused venue", async () => {
    const shop = await createVenue({ name: "Shakespeare and Company", type: "bookshop" });
    const [book] = await c`insert into works(title,slug) values ('Ulysses','ulysses') returning id`;
    await c`insert into orders(work_id, venue_id, acquisition_method, order_date, status, price, currency)
      values (${book.id}, ${shop.id}, 'in_store_purchase', '2026-05-01', 'received', 18.5, 'EUR')`;
    const orders = await getVenueOrders(shop.id);
    expect(orders).toEqual({
      total: 1,
      rows: [expect.objectContaining({ title: "Ulysses", slug: "ulysses", status: "received", price: 18.5, currency: "EUR" })],
    });
    expect(await getVenueReferences(shop.id)).toMatchObject({ orders: 1, whereabouts: 0, listings: 0 });
    expect(await failure(removeVenue(shop.id))).toBe("Records still refer to this venue. Archive it instead.");

    await setVenueArchived(shop.id, true);
    expect((await getVenues()).map((v) => v.id)).not.toContain(shop.id);
    expect((await getVenues({ filters: { archived: "include" } })).map((v) => v.id)).toContain(shop.id);
    expect((await getVenues({ filters: { archived: "only" } })).map((v) => v.id)).toEqual([shop.id]);
    // The page still opens, with its orders
    expect(await getVenueBySlug(shop.slug!)).toMatchObject({ name: "Shakespeare and Company" });
    await setVenueArchived(shop.id, false);
    expect((await getVenues()).map((v) => v.id)).toContain(shop.id);

    // Edits keep the address the venue already has
    await updateVenue(shop.id, { name: "Shakespeare & Co", personalRating: 5, firstVisitDate: "2020-01-02" });
    expect(await getVenueBySlug(shop.slug!)).toMatchObject({ name: "Shakespeare & Co", personalRating: 5, slug: shop.slug });

    const unused = await createVenue({ name: "Pop-up fair", type: "fair" });
    await removeVenue(unused.id);
    expect(await getVenueBySlug(unused.slug!)).toBeUndefined();
  });

  it("finds a venue's country through the places above it", async () => {
    const [country] = await c`insert into countries(name, alpha_2, alpha_3) values ('Testland', 'TL', 'TLD') returning id`;
    const [city] = await c`insert into places(name, type, country_id) values ('Capital', 'city', ${country.id}) returning id`;
    const [district] = await c`insert into places(name, type, parent_id) values ('Old Town', 'district', ${city.id}) returning id`;
    const inside = await createVenue({ name: "Old Town Books", type: "bookshop", placeId: district.id });
    await createVenue({ name: "Nowhere Store", type: "online_store" });
    expect(await getVenueCountries()).toEqual([{ id: country.id, name: "Testland", count: 1 }]);
    expect((await getVenues({ filters: { countryIds: [country.id] } })).map((v) => v.id)).toEqual([inside.id]);
  });
});
