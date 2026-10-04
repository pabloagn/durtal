import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_ORGANIZATION_DIRECTORY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln369_test")
    throw new Error("Organization directory tests require disposable local sln369_test");
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
  addOrganization,
  getOrganizationContributions,
  getOrganizationDirectory,
  getOrganizationRoleCounts,
  removeOrganization,
  updateOrganizationProfile,
} from "@/lib/actions/organization-directory";
import { getPerfumeFilterOptions, getPerfumes } from "@/lib/actions/perfumes";
import { hasPerfumeFilters, perfumeQueryFromParams } from "@/lib/catalogue/perfume-params";
import { getOrganization, linkOrganizationVenue, saveOrganization } from "@/lib/actions/organizations";
import { createAcquisitionTarget, savePublisher } from "@/lib/actions/publishers";
import { createPerfume } from "@/lib/actions/perfumes";
import { createFilm, createFilmVersion } from "@/lib/actions/films";
import { createArtObject, createPainting } from "@/lib/actions/paintings";
import { getWhereabouts, recordWhereabouts } from "@/lib/actions/whereabouts";
import { createVenue } from "@/lib/actions/venues";
import { addPerfumeRetailerLink } from "@/lib/actions/perfume-retailers";
import { boundedCount, organizationRoleText } from "@/lib/catalogue/organizations";

describe.skipIf(!url)("shared organization directory", () => {
  const c = client!;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint if exists works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, venues, places, catalogue_dates, activity_events, harmonization_operations, harmonization_redirects cascade`;
  });

  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error("Expected the call to fail");
      },
      (e: Error) => e.message,
    );
  /**
   * A book with `count` editions, all published by `publisherId`. The links
   * are confirmed, so the name rules leave them as they are.
   */
  async function editions(publisherId: string, count: number, title = "Book") {
    const [book] = await c`insert into works(title) values (${title}) returning id`;
    const made = await c`insert into editions(work_id, title, publisher_links_confirmed)
      select ${book.id}, ${title} || ' ' || n, true from generate_series(1, ${count}::int) n returning id`;
    await c`insert into edition_publishers(edition_id, publisher_id)
      select id, ${publisherId}::uuid from unnest(${made.map((e) => e.id)}::uuid[]) id`;
    return book.id as string;
  }

  /** One house in every collection: books, perfumes, films and paintings */
  async function lumiere() {
    const org = (await saveOrganization({
      name: "Maison Lumière",
      roles: ["publisher", "perfume_house", "production_company", "distribution_company", "museum"],
      aliases: ["Lumière Frères"],
      country: "France",
    }))!;
    await editions(org.id, 2, "Les Lumières");
    const perfume = await createPerfume({
      title: "Lumière Noire",
      organizations: [{ organizationId: org.id, role: "perfume_house" }],
    });
    const film = await createFilm({
      title: "Arrival of a Train",
      organizations: [{ organizationId: org.id, role: "production_company" }],
    });
    const distributed = await createFilm({ title: "Workers Leaving the Factory" });
    await createFilmVersion({
      workId: distributed.id,
      releases: [{ countryId: null, territoryLabel: "Worldwide", format: "theatrical", distributorId: org.id }],
    });
    const painting = await createPainting({ title: "The Garden" });
    const object = await createArtObject({
      workId: painting.id,
      kind: "original",
      ownership: "institutional",
      ownerOrganizationId: org.id,
    });
    const venue = await createVenue({ name: "Musée Lumière", type: "museum" });
    await linkOrganizationVenue({ organizationId: org.id, venueId: venue.id });
    await recordWhereabouts(
      { objectId: object.id, placeKind: "venue", venueId: venue.id, custody: "permanent_collection", certainty: "confirmed" },
      (await getWhereabouts(object.id))!.fingerprint,
    );
    return { org, perfume, film, distributed, painting, venue };
  }

  it("lists one organization with all its roles and what it does in each collection", async () => {
    const { org, perfume, film, distributed, painting } = await lumiere();
    await saveOrganization({ name: "Galerie Nord", roles: ["gallery"] });

    const { rows, total } = await getOrganizationDirectory();
    expect(total).toBe(2);
    const row = rows.find((r) => r.id === org.id)!;
    expect(row).toMatchObject({ name: "Maison Lumière", slug: org.slug, country: "France" });
    expect(organizationRoleText(row.roles)).toBe(
      "Publisher · Perfume house · Production company · Distributor · Museum",
    );
    expect(row.counts).toEqual({
      editions: 2,
      houses: 0,
      wanted: 0,
      perfumes: 1,
      films: 2,
      paintings: 1,
      venues: 1,
      supplied: 0,
    });
    expect(Object.values(rows.find((r) => r.name === "Galerie Nord")!.counts).every((n) => n === 0)).toBe(true);

    const contributions = await getOrganizationContributions(org.id);
    expect(contributions.publishing).toMatchObject({ editions: 2, books: 1, children: [], parent: null });
    expect(contributions.perfumes.roles.map((r) => [r.role, r.total, r.cards.map((p) => p.id)])).toEqual([
      ["perfume_house", 1, [perfume.id]],
      ["brand", 0, []],
      ["manufacturer", 0, []],
    ]);
    expect(contributions.films.produced).toMatchObject({ total: 1, cards: [expect.objectContaining({ id: film.id })] });
    expect(contributions.films.distributed).toMatchObject({
      total: 1,
      cards: [expect.objectContaining({ id: distributed.id })],
    });
    expect(contributions.paintings.owned).toMatchObject({
      total: 1,
      objects: 1,
      cards: [expect.objectContaining({ id: painting.id, title: "The Garden" })],
    });
    expect(contributions.paintings.shown.cards.map((p) => p.id)).toEqual([painting.id]);
  });

  it("filters by one role, counts each role and finds other names", async () => {
    const { org } = await lumiere();
    const group = await savePublisher({ name: "Groupe Hachette", kind: "group" });
    await saveOrganization({ name: "Galerie Nord", roles: ["gallery", "retailer"] });

    const counts = await getOrganizationRoleCounts();
    expect(counts.all).toBe(3);
    expect(counts.roles).toMatchObject({ group: 1, publisher: 1, museum: 1, gallery: 1, retailer: 1, imprint: 0 });
    expect((await getOrganizationDirectory({ role: "group" })).rows.map((r) => r.id)).toEqual([group.id]);
    expect((await getOrganizationDirectory({ role: "museum" })).rows.map((r) => r.id)).toEqual([org.id]);
    expect((await getOrganizationDirectory({ role: "imprint" })).total).toBe(0);

    // An other name finds the organization; the counts follow the search
    expect((await getOrganizationDirectory({ query: "freres" })).rows.map((r) => r.id)).toEqual([org.id]);
    expect((await getOrganizationRoleCounts("galerie")).all).toBe(1);
    expect((await getOrganizationRoleCounts("galerie")).roles.museum).toBe(0);

    const page = await getOrganizationDirectory({ limit: 2, offset: 2 });
    expect(page).toMatchObject({ total: 3, rows: [expect.objectContaining({ name: "Maison Lumière" })] });
  });

  it("stops a row's counts at the cap and keeps the page's counts exact", async () => {
    const org = (await saveOrganization({ name: "Penguin", roles: ["publisher"] }))!;
    await editions(org.id, 1001);
    const [row] = (await getOrganizationDirectory()).rows;
    expect(row.counts.editions).toBe(1000);
    expect(boundedCount(row.counts.editions)).toBe("999+");
    expect(boundedCount(999)).toBe("999");
    expect((await getOrganizationContributions(org.id)).publishing).toMatchObject({ editions: 1001, books: 1 });
  });

  it("edits the profile and keeps the publishing level, the house above and the address", async () => {
    const group = await savePublisher({ name: "Groupe Hachette", kind: "group" });
    const publisher = await savePublisher({ name: "Hachette Livre", kind: "publisher", parentId: group.id });
    await updateOrganizationProfile(publisher.id, {
      name: "Hachette Livre",
      roles: ["retailer"],
      aliases: ["Hachette"],
      website: "https://hachette.example",
    });
    const saved = (await getOrganization(publisher.id))!;
    expect(saved).toMatchObject({ kind: "publisher", parentId: group.id, slug: publisher.slug, website: "https://hachette.example" });
    expect(saved.roles).toEqual(["publisher", "retailer"]);
    expect(saved.aliases.map((a) => a.name)).toEqual(["Hachette"]);
    expect((await getOrganizationContributions(group.id)).publishing.children).toEqual([
      expect.objectContaining({ id: publisher.id, name: "Hachette Livre", kind: "publisher" }),
    ]);

    // A group keeps its level too, and a role records use stays
    await updateOrganizationProfile(group.id, { name: "Hachette Group", roles: [] });
    expect(await getOrganization(group.id)).toMatchObject({ kind: "group", name: "Hachette Group" });
    const [work] = await c`insert into works(title,kind,original_language) values ('Fragrance','perfume',null) returning id`;
    await c`insert into perfume_details(work_id) values (${work.id})`;
    await addPerfumeRetailerLink({ workId: work.id, organizationId: publisher.id, url: "https://hachette.example/p" });
    expect(await failure(updateOrganizationProfile(publisher.id, { name: "Hachette Livre", roles: [] }))).toBe(
      "This organization role is in use by perfume records",
    );
    // An organization without a book profile needs a role
    const shop = (await saveOrganization({ name: "Shop", roles: ["retailer"] }))!;
    expect(await failure(updateOrganizationProfile(shop.id, { name: "Shop", roles: [] }))).toBe(
      "Choose at least one role for this organization",
    );
  });

  it("shows a sparse organization with nothing linked and deletes only an unlinked one", async () => {
    const museum = (await saveOrganization({ name: "Empty Museum", roles: ["museum"] }))!;
    const contributions = await getOrganizationContributions(museum.id);
    expect(contributions.publishing).toMatchObject({ editions: 0, books: 0, children: [], parent: null });
    expect(contributions.perfumes.roles.every((r) => r.total === 0 && r.cards.length === 0)).toBe(true);
    expect(contributions.films.produced).toEqual({ total: 0, cards: [] });
    expect(contributions.paintings.owned).toEqual({ total: 0, objects: 0, cards: [] });

    const publisher = (await saveOrganization({ name: "Busy", roles: ["publisher"] }))!;
    await editions(publisher.id, 1);
    expect(await failure(removeOrganization(publisher.id))).toBe(
      "Records still link to this organization. Remove those links first.",
    );
    await removeOrganization(museum.id);
    expect(await getOrganization(museum.id)).toBeUndefined();
  });

  it("counts a group's houses, a supplier's copies and the books wanted, so no linked row reads empty", async () => {
    const group = await savePublisher({ name: "Groupe Hachette", kind: "group" });
    const publisher = await savePublisher({ name: "Hachette Livre", kind: "publisher", parentId: group.id });
    const book = await editions(publisher.id, 3, "Les Misérables");
    await createAcquisitionTarget({ workId: book, publisherId: publisher.id });
    const supplier = (await saveOrganization({ name: "Bottle Shop", roles: ["retailer"] }))!;
    const [work] = await c`insert into works(title,kind,original_language) values ('Fragrance','perfume',null) returning id`;
    await c`insert into perfume_details(work_id) values (${work.id})`;
    const [variant] = await c`insert into perfume_variants(work_id) values (${work.id}) returning id`;
    await c`insert into perfume_bottles(variant_id, container, capacity_value, volume_unit, supplier_id)
      values (${variant.id}, 'bottle', 100, 'ml', ${supplier.id})`;

    const { rows } = await getOrganizationDirectory();
    const counts = (name: string) => rows.find((r) => r.name === name)!.counts;
    expect(counts("Groupe Hachette")).toMatchObject({ editions: 0, houses: 1 });
    expect(counts("Hachette Livre")).toMatchObject({ editions: 3, wanted: 1 });
    expect(counts("Bottle Shop")).toMatchObject({ supplied: 1, perfumes: 0 });
    // The group's page counts its houses' books
    expect((await getOrganizationContributions(group.id)).publishing).toMatchObject({
      editions: 0,
      familyEditions: 3,
      familyBooks: 1,
      children: [expect.objectContaining({ id: publisher.id })],
    });
    expect((await getOrganizationContributions(publisher.id)).publishing).toMatchObject({ wanted: 1 });
  });

  it("searches within one role", async () => {
    await saveOrganization({ name: "Galerie Nord", roles: ["gallery"] });
    await saveOrganization({ name: "Galerie Sud", roles: ["retailer"] });
    await saveOrganization({ name: "Musée Nord", roles: ["museum"] });
    expect((await getOrganizationDirectory({ query: "galerie", role: "retailer" })).rows.map((r) => r.name)).toEqual([
      "Galerie Sud",
    ]);
    expect((await getOrganizationDirectory({ query: "nord", role: "gallery" })).total).toBe(1);
    expect((await getOrganizationDirectory({ query: "nord", role: "imprint" })).total).toBe(0);
  });

  it("keeps the country id in step with the country an edit names", async () => {
    await c`insert into countries(name, alpha_2, alpha_3) values ('Testonia', 'TX', 'TXA'), ('Otherland', 'OX', 'OXA')
      on conflict do nothing`;
    const [testonia] = await c`select id from countries where alpha_2 = 'TX'`;
    const [otherland] = await c`select id from countries where alpha_2 = 'OX'`;
    const shop = (await addOrganization({ name: "Shop", roles: ["retailer"], country: "Testonia" }))!;
    expect(await getOrganization(shop.id)).toMatchObject({ country: "Testonia", countryId: testonia.id });
    await updateOrganizationProfile(shop.id, { name: "Shop", roles: ["retailer"], country: "Otherland" });
    expect(await getOrganization(shop.id)).toMatchObject({
      country: "Otherland",
      countryId: otherland.id,
      countryRef: expect.objectContaining({ name: "Otherland" }),
    });
    await updateOrganizationProfile(shop.id, { name: "Shop", roles: ["retailer"], country: null });
    expect(await getOrganization(shop.id)).toMatchObject({ country: null, countryId: null });
  });

  it("keeps an owner of paintings a museum or a gallery", async () => {
    const { org } = await lumiere();
    const roles = ["perfume_house", "production_company", "distribution_company"] as const;
    expect(await failure(updateOrganizationProfile(org.id, { name: org.name, roles: [...roles] }))).toBe(
      "This organization owns paintings; keep it a museum or a gallery",
    );
    // A gallery in place of the museum keeps it an institution
    await updateOrganizationProfile(org.id, { name: org.name, roles: [...roles, "gallery"] });
    expect((await getOrganization(org.id))!.roles).toContain("gallery");
  });

  it("narrows a house filter to one role, for an organization's role rows", async () => {
    const guerlain = (await saveOrganization({ name: "Guerlain", roles: ["perfume_house", "brand"] }))!;
    const own = await createPerfume({ title: "Shalimar", organizations: [{ organizationId: guerlain.id, role: "perfume_house" }] });
    const branded = await createPerfume({ title: "Aqua", organizations: [{ organizationId: guerlain.id, role: "brand" }] });
    const ids = async (params: Record<string, string>) => (await getPerfumes(perfumeQueryFromParams(params))).map((p) => p.id);
    expect((await ids({ house: guerlain.id })).sort()).toEqual([own.id, branded.id].sort());
    expect(await ids({ house: guerlain.id, houseRole: "perfume_house" })).toEqual([own.id]);
    expect(await ids({ house: guerlain.id, houseRole: "brand" })).toEqual([branded.id]);
    // An unknown role is ignored
    expect((await ids({ house: guerlain.id, houseRole: "owner" })).length).toBe(2);
    // A manufacturer is a house too, and shows ticked in the House list
    const interparfums = (await saveOrganization({ name: "Interparfums", roles: ["manufacturer"] }))!;
    const made = await createPerfume({
      title: "Made Here",
      organizations: [{ organizationId: interparfums.id, role: "manufacturer" }],
    });
    expect(await ids({ house: interparfums.id })).toEqual([made.id]);
    expect(await ids({ house: interparfums.id, houseRole: "manufacturer" })).toEqual([made.id]);
    expect((await getPerfumeFilterOptions()).houses.map((h) => h.name)).toEqual(["Guerlain", "Interparfums"]);
    // A role left on its own filters nothing and is not a filter
    expect(perfumeQueryFromParams({ houseRole: "brand" })).not.toHaveProperty("houseRole");
    expect(hasPerfumeFilters({ houseRole: "brand" })).toBe(false);
    expect(hasPerfumeFilters({ house: guerlain.id, houseRole: "brand" })).toBe(true);
  });
});
