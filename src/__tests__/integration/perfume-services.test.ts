import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import { ownedPrefixes } from "@/lib/s3/cleanup";
import { CATALOGUE_DATE_REFERENCES } from "@/lib/catalogue/dates";

const url = process.env.DURTAL_PERFUME_SERVICES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln357_test")
    throw new Error("Perfume service tests require disposable local sln357_test");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  deleteUnusedObjects: vi.fn(async () => false),
}));
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
  invalidate: mocks.invalidate,
  cached: (fn: unknown) => fn,
  CACHE_TAGS: {
    works: "data:works",
    authors: "ref:authors",
    customTaxonomyItems: "ref:custom-taxonomy-items",
    locations: "ref:locations",
    venues: "ref:venues",
    media: "data:media",
    comments: "data:comments",
    activity: "data:activity",
  },
}));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: mocks.deleteUnusedObjects,
}));
import {
  addPerfumeBottle,
  createPerfume,
  createPerfumeVariant,
  deletePerfume,
  deletePerfumeBottle,
  deletePerfumeVariant,
  getPerfume,
  getPerfumeBottle,
  getPerfumeCount,
  getPerfumes,
  getPerfumeVariant,
  updatePerfume,
  updatePerfumeBottle,
  updatePerfumeVariant,
} from "@/lib/actions/perfumes";
import { createPerson } from "@/lib/actions/people";
import { saveOrganization, deleteOrganization } from "@/lib/actions/organizations";
import { recordSourceObservation } from "@/lib/actions/catalogue-provenance";
import { updateWorkCuration, getWorkCuration } from "@/lib/actions/curation";
import {
  addPerfumeRetailerLink,
  deletePerfumeRetailerLink,
} from "@/lib/actions/perfume-retailers";
import { z } from "zod";
import type { CreatePerfumeInput, PerfumeQuery } from "@/lib/validations/perfumes";
import { STALE_RECORD } from "@/lib/catalogue/work-store";
import { collectionExportRows } from "@/lib/export/collections";
import { POST as exportCatalogue } from "@/app/api/export/route";
import { NextRequest } from "next/server";

/**
 * The message a caller sees. Database errors must arrive as their written
 * message, never as SQL, so this compares the whole message.
 */
async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error("Expected the call to fail");
    },
    (e: unknown) => e,
  );
  return error instanceof z.ZodError
    ? error.issues.map((issue) => issue.message).join("\n")
    : (error as Error).message;
}

describe.skipIf(!url)("perfume catalogue and inventory services", () => {
  const c = client!;
  let people: Record<string, string>;
  let orgs: Record<string, string>;
  let items: Record<string, string>;
  let families: Record<string, string>;
  let shelf: string, cloud: string;
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await c`truncate works, authors, publishing_houses, venues, locations, custom_taxonomy_items, catalogue_dates, comments, activity_events, gallery_layouts, harmonization_operations, harmonization_redirects cascade`;
    people = {};
    for (const [key, name] of [
      ["polge", "Jacques Polge"],
      ["beaux", "Ernest Beaux"],
      ["sheldrake", "Olivier Polge"],
      ["director", "Creative Director"],
    ])
      people[key] = (await createPerson({ name, domains: ["perfume"] })).id;
    orgs = {};
    for (const [key, name, roles] of [
      ["chanel", "Chanel", ["perfume_house", "brand", "manufacturer"]],
      ["guerlain", "Guerlain", ["perfume_house"]],
      ["shop", "Perfume Shop", ["retailer"]],
    ] as const)
      orgs[key] = (await saveOrganization({ name, roles: [...roles] }))!.id;
    families = Object.fromEntries(
      (await c`select id,slug from taxonomy_families where slug like 'perfume-%'`).map((r) => [r.slug, r.id]),
    );
    items = {};
    for (const [key, familySlug, parent] of [
      ["citrus", "perfume-notes", null],
      ["bergamot", "perfume-notes", "citrus"],
      ["rose", "perfume-notes", null],
      ["vanilla", "perfume-notes", null],
      ["floral", "perfume-families", null],
      ["woody", "perfume-families", null],
      ["powdery", "perfume-accords", null],
    ] as const) {
      const [row] =
        await c`insert into custom_taxonomy_items(family_id,name,slug,parent_id) values (${families[familySlug]},${key},${key},${parent ? items[parent] : null}) returning id`;
      items[key] = row.id;
    }
    [shelf, cloud] = (
      await c`insert into locations(name,type) values ('Shelf','physical'),('Cloud','digital') returning id`
    ).map((r) => r.id);
  });

  const perfumer = (key: string) => ({ personId: people[key], roleId: "perfume.perfumer" });
  const fullPerfume = () =>
    createPerfume({
      title: "No 5",
      description: "Aldehydic floral",
      releaseDate: year(1921),
      organizations: [
        { organizationId: orgs.chanel, role: "perfume_house" },
        { organizationId: orgs.chanel, role: "manufacturer" },
      ],
      credits: [perfumer("beaux"), { personId: people.director, roleId: "perfume.creative_director" }],
      notePyramid: [
        { itemId: items.bergamot, position: "top" },
        { itemId: items.rose, position: "heart" },
        { itemId: items.vanilla, position: "base" },
      ],
      classificationItemIds: [items.floral, items.powdery],
    });

  it("creates a fragrance with every section in one transaction and reads it back", async () => {
    const perfume = await fullPerfume();
    expect(perfume.slug).toBe("no-5-by-chanel");
    expect(perfume.releaseDate?.value).toMatchObject({ precision: "year", start: { year: 1921 } });
    expect(perfume.organizations.map((o) => o.role)).toEqual(["perfume_house", "manufacturer"]);
    expect(perfume.credits.map((credit) => credit.personId)).toEqual([people.beaux, people.director]);
    expect(perfume.notePyramid.map((n) => [n.name, n.position])).toEqual([
      ["bergamot", "top"],
      ["rose", "heart"],
      ["vanilla", "base"],
    ]);
    expect(perfume.classification.map((n) => n.name).sort()).toEqual(["floral", "powdery"]);
    expect(perfume.fingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(await getPerfume(perfume.slug!)).toMatchObject({ id: perfume.id });
    const [work] = await c`select kind,original_language from works where id=${perfume.id}`;
    expect(work).toEqual({ kind: "perfume", original_language: null });
    expect(await c`select id from editions`).toHaveLength(0);
    expect(mocks.invalidate).toHaveBeenCalledWith("data:works", "ref:authors", "ref:custom-taxonomy-items");
  });

  it("rolls every section back when a late part fails", async () => {
    await expect(
      createPerfume({
        title: "Broken",
        releaseDate: year(1990),
        organizations: [{ organizationId: orgs.chanel, role: "perfume_house" }],
        credits: [perfumer("polge")],
        notePyramid: [{ itemId: items.rose, position: "heart" }],
        classificationItemIds: [items.rose],
      }),
    ).rejects.toThrow(/^Use positioned perfume notes instead of generic taxonomy assignment$/);
    // Naming Guerlain as manufacturer gives it that role in the same write: a
    // late failure takes the role back with everything else
    await expect(
      createPerfume({
        title: "New role",
        organizations: [{ organizationId: orgs.guerlain, role: "manufacturer" }],
        classificationItemIds: [items.rose],
      }),
    ).rejects.toThrow(/^Use positioned perfume notes instead of generic taxonomy assignment$/);
    expect(
      await c`select 1 from organization_roles where organization_id=${orgs.guerlain} and role='manufacturer'`,
    ).toHaveLength(0);
    for (const table of ["works", "perfume_details", "catalogue_dates", "perfume_organizations", "perfume_notes", "work_credits"])
      expect(await c`select 1 from ${c(table)}`, table).toHaveLength(0);
  });

  it("replaces only supplied sections and never overwrites curation or other sections", async () => {
    const perfume = await fullPerfume();
    await updateWorkCuration({
      owner: { kind: "perfume", id: perfume.id },
      patch: { rating: 5, notes: "Signature" },
      fingerprint: (await getWorkCuration({ kind: "perfume", id: perfume.id }))!.fingerprint,
    });
    const afterCuration = (await getPerfume(perfume.id))!;
    expect(afterCuration.fingerprint).toBe(perfume.fingerprint);
    const source = await recordSourceObservation({
      owner: { kind: "perfume", id: perfume.id },
      provider: "archive",
      retrievedAt: new Date("2026-01-01"),
      payload: { house: "Chanel" },
    });
    const updated = await updatePerfume(
      perfume.id,
      {
        title: "No 5 Parfum",
        organizations: [{ organizationId: orgs.chanel, role: "perfume_house", sourceRecordId: source.id }],
      },
      perfume.fingerprint,
    );
    expect(updated.title).toBe("No 5 Parfum");
    expect(updated.slug).toBe(perfume.slug);
    expect(updated.organizations).toEqual([expect.objectContaining({ role: "perfume_house", sourceRecordId: source.id })]);
    expect(updated.notePyramid).toEqual(perfume.notePyramid);
    expect(updated.credits.map((credit) => credit.id)).toEqual(perfume.credits.map((credit) => credit.id));
    expect(updated.curation).toEqual({ notes: "Signature", rating: 5, isFavourite: false });
    expect(updated.fingerprint).not.toBe(perfume.fingerprint);
    await expect(updatePerfume(perfume.id, { title: "Lost edit" }, perfume.fingerprint)).rejects.toThrow(STALE_RECORD);
    await expect(updatePerfume(randomUUID(), { title: "Absent" }, perfume.fingerprint)).rejects.toThrow(/^Record not found$/);
  });

  it("stores edited dates as new immutable values and releases replaced ones", async () => {
    const perfume = await fullPerfume();
    const same = await updatePerfume(perfume.id, { releaseDate: year(1921) }, perfume.fingerprint);
    expect(same.releaseDate!.id).toBe(perfume.releaseDate!.id);
    const month = await updatePerfume(
      perfume.id,
      { releaseDate: { precision: "month", start: { year: 1921, month: 5 } }, discontinuedDate: { precision: "range", start: { year: 1950 }, end: { year: 1960 } } },
      same.fingerprint,
    );
    expect(month.releaseDate!.id).not.toBe(perfume.releaseDate!.id);
    expect(await c`select id from catalogue_dates`).toHaveLength(2);
    await expect(
      updatePerfume(perfume.id, { discontinuedDate: year(1900) }, month.fingerprint),
    ).rejects.toThrow(/^The end date cannot precede the start date$/);
    const cleared = await updatePerfume(perfume.id, { releaseDate: null, discontinuedDate: null }, month.fingerprint);
    expect(cleared.releaseDate).toBeNull();
    expect(await c`select id from catalogue_dates`).toHaveLength(0);
  });

  it("keeps credit identities through reordering and rejects foreign credit IDs", async () => {
    const perfume = await fullPerfume();
    const [beaux, director] = perfume.credits;
    const reordered = await updatePerfume(
      perfume.id,
      {
        credits: [
          { id: director.id, personId: people.director, roleId: "perfume.creative_director" },
          { id: beaux.id, personId: people.beaux, roleId: "perfume.perfumer" },
        ],
      },
      perfume.fingerprint,
    );
    expect(reordered.credits.map((credit) => credit.id)).toEqual([director.id, beaux.id]);
    await expect(
      updatePerfume(perfume.id, { credits: [{ id: randomUUID(), ...perfumer("polge") }] }, reordered.fingerprint),
    ).rejects.toThrow(/^A credit ID belongs to another record or was removed$/);
    await expect(
      updatePerfume(perfume.id, { credits: [{ personId: people.polge, roleId: "film.director" }] }, reordered.fingerprint),
    ).rejects.toThrow(/^Contribution role does not apply to perfumes$/);
  });

  it("serializes concurrent edits so exactly one save wins", async () => {
    const perfume = await fullPerfume();
    const results = await Promise.allSettled(
      ["First", "Second", "Third"].map((title) => updatePerfume(perfume.id, { title }, perfume.fingerprint)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected"))
      expect((r as PromiseRejectedResult).reason.message).toBe(STALE_RECORD);
  });

  it("models formulations with inheritance, explicit empty replacements and unique identities", async () => {
    const perfume = await fullPerfume();
    const edp = await createPerfumeVariant({ workId: perfume.id, concentration: "eau_de_parfum" });
    expect(edp.perfumers).toEqual([expect.objectContaining({ personId: people.beaux, inherited: true })]);
    expect(edp.notePyramid.every((n) => n.inherited)).toBe(true);
    const extrait = await createPerfumeVariant({
      workId: perfume.id,
      concentration: "extrait",
      perfumers: [],
      notePyramid: [{ itemId: items.rose, position: "heart" }],
      classification: [{ familyId: families["perfume-families"], itemIds: [items.woody] }],
    });
    expect(extrait.perfumers).toEqual([]);
    expect(extrait.notePyramid).toEqual([expect.objectContaining({ name: "rose", inherited: false })]);
    expect(extrait.classification.map((c) => [c.name, c.inherited]).sort()).toEqual([
      ["powdery", true],
      ["woody", false],
    ]);
    await expect(createPerfumeVariant({ workId: perfume.id, concentration: "eau_de_parfum" })).rejects.toThrow(/^This perfume already has a formulation with this concentration and labels$/);
    await expect(
      updatePerfumeVariant(extrait.id, { concentration: "eau_de_parfum" }, extrait.fingerprint),
    ).rejects.toThrow(/^This perfume already has a formulation with this concentration and labels$/);
    await expect(
      createPerfumeVariant({ workId: perfume.id, formulationLabel: "2020", classification: [{ familyId: families["perfume-families"], itemIds: [items.powdery] }] }),
    ).rejects.toThrow(/^An item does not belong to the family it replaces$/);
    // A size is a container attribute, never a formulation.
    await expect(
      createPerfumeVariant({ workId: perfume.id, capacityValue: 100 } as never),
    ).rejects.toThrow();

    const inherited = await updatePerfumeVariant(
      extrait.id,
      { notePyramid: null, classification: [], perfumers: [{ personId: people.polge }] },
      extrait.fingerprint,
    );
    expect(inherited.notePyramid.every((n) => n.inherited)).toBe(true);
    expect(inherited.classification.every((c) => c.inherited)).toBe(true);
    expect(inherited.perfumers).toEqual([expect.objectContaining({ personId: people.polge, inherited: false })]);
    expect(inherited.overriddenFamilyIds).toEqual([]);
    const restored = await updatePerfumeVariant(extrait.id, { perfumers: null }, inherited.fingerprint);
    expect(restored.perfumers).toEqual([expect.objectContaining({ personId: people.beaux, inherited: true })]);
    await expect(updatePerfumeVariant(extrait.id, { notes: "late" }, inherited.fingerprint)).rejects.toThrow(STALE_RECORD);
  });

  it("keeps a flanker as its own fragrance", async () => {
    const original = await fullPerfume();
    const flanker = await createPerfume({ title: "No 5 L'Eau", organizations: [{ organizationId: orgs.chanel, role: "perfume_house" }] });
    await createPerfumeVariant({ workId: flanker.id, concentration: "eau_de_toilette" });
    expect(flanker.id).not.toBe(original.id);
    expect((await getPerfume(original.id))!.variants).toHaveLength(0);
    expect(await getPerfumeCount()).toBe(2);
  });

  it("never gives a perfume the slug of the Add perfume page", async () => {
    // /perfumes/new is the Add perfume page: a perfume titled "New" never takes it
    expect((await createPerfume({ title: "New" })).slug).toBe("new-2");
    expect((await createPerfume({ title: "New" })).slug).toBe("new-3");
  });

  it("adds containers within quantity bounds and records disposition", async () => {
    const perfume = await fullPerfume();
    const edp = await createPerfumeVariant({ workId: perfume.id, concentration: "eau_de_parfum" });
    const other = await createPerfume({ title: "Other" });
    const otherVariant = await createPerfumeVariant({ workId: other.id });
    const bottle = await addPerfumeBottle({
      variantId: edp.id, container: "bottle", capacityValue: 100, volumeUnit: "ml", remainingMl: 80,
      locationId: shelf, acquisitionDate: year(2020), acquisitionPrice: 150, acquisitionCurrency: "EUR",
    });
    expect(bottle).toMatchObject({ capacityMl: 100, remainingMl: 80, status: "held", locationName: "Shelf" });
    const sample = await addPerfumeBottle({ variantId: edp.id, container: "sample", capacityValue: 0.002, volumeUnit: "l" });
    expect(sample.capacityMl).toBe(2);
    for (const invalid of [
      { remainingMl: 120 },
      { capacityValue: 0.0005 },
      { acquisitionPrice: 10 },
      { status: "held" as const, dispositionReason: "Gift" },
    ])
      await expect(
        addPerfumeBottle({ variantId: edp.id, container: "bottle", capacityValue: 100, volumeUnit: "ml", ...invalid }),
      ).rejects.toThrow();
    await expect(
      addPerfumeBottle({ variantId: edp.id, container: "bottle", capacityValue: 50, volumeUnit: "ml", locationId: cloud }),
    ).rejects.toThrow(/^Perfume containers require a physical personal location$/);

    const disposed = await updatePerfumeBottle(
      bottle.id,
      { status: "disposed", dispositionDate: year(2024), dispositionReason: "Gift" },
      bottle.fingerprint,
    );
    expect(disposed.dispositionDate?.value.start?.year).toBe(2024);
    expect((await getPerfume(perfume.id))!.holdings).toMatchObject({ activeCount: 1, disposedCount: 1, samples: 1, bottles: 0 });
    expect(await failure(updatePerfumeBottle(bottle.id, { status: "held" }, disposed.fingerprint))).toBe("Disposition details require a disposed container");
    await expect(updatePerfumeBottle(bottle.id, { remainingMl: 10 }, bottle.fingerprint)).rejects.toThrow(STALE_RECORD);
    const restored = await updatePerfumeBottle(
      bottle.id,
      { status: "held", dispositionDate: null, dispositionReason: null, remainingMl: 70 },
      disposed.fingerprint,
    );
    expect(restored).toMatchObject({ status: "held", dispositionDateId: null, remainingMl: 70, acquisitionDateId: bottle.acquisitionDateId });
    expect(await failure(updatePerfumeBottle(bottle.id, { remainingMl: 101 }, restored.fingerprint))).toBe("Remaining volume exceeds capacity");
    await expect(
      updatePerfumeBottle(bottle.id, { variantId: otherVariant.id }, restored.fingerprint),
    ).rejects.toThrow(/^A container can only move to another formulation of the same perfume$/);
    const extrait = await createPerfumeVariant({ workId: perfume.id, concentration: "extrait" });
    const moved = await updatePerfumeBottle(bottle.id, { variantId: extrait.id, acquisitionDate: year(2021) }, restored.fingerprint);
    expect(moved.variantId).toBe(extrait.id);
    expect(moved.acquisitionDateId).not.toBe(bottle.acquisitionDateId);
    expect(await c`select id from catalogue_dates where id=${bottle.acquisitionDateId}`).toHaveLength(0);
    await deletePerfumeBottle(sample.id);
    expect(await getPerfumeBottle(sample.id)).toBeNull();
  });

  it("protects fragrances and formulations with containers or retailer history", async () => {
    const perfume = await fullPerfume();
    const edp = await createPerfumeVariant({ workId: perfume.id, concentration: "eau_de_parfum", releaseDate: year(1986) });
    const bottle = await addPerfumeBottle({ variantId: edp.id, container: "bottle", capacityValue: 50, volumeUnit: "ml" });
    await expect(deletePerfumeVariant(edp.id)).rejects.toThrow(/^Delete or move this formulation's bottles, samples and decants first$/);
    await expect(deletePerfume(perfume.id)).rejects.toThrow(/^Delete or move this perfume's bottles, samples and decants first$/);
    await expect(deleteOrganization(orgs.chanel)).rejects.toThrow();
    await deletePerfumeBottle(bottle.id);
    const listing = await addPerfumeRetailerLink({ workId: perfume.id, variantId: edp.id, organizationId: orgs.shop, url: "https://shop.example/no5" });
    await expect(deletePerfumeVariant(edp.id)).rejects.toThrow(/^Delete this formulation's retailer listings first/);
    await expect(deletePerfume(perfume.id)).rejects.toThrow(/^Delete this perfume's retailer listings first/);
    expect(await getPerfume(perfume.id)).not.toBeNull();
    await deletePerfumeRetailerLink(listing.id);

    const poster = `gold/media/work/${perfume.id}/poster/a.webp`;
    const thumb = `gold/media/work/${perfume.id}/poster/a_thumb.webp`;
    await c`insert into media(work_id,type,s3_key,thumbnail_s3_key) values (${perfume.id},'poster',${poster},${thumb})`;
    await c`insert into comments(entity_type,entity_id,content_html) values ('work',${perfume.id},'<p>Note</p>')`;
    await c`insert into activity_events(entity_type,entity_id,event_key,metadata) values ('work',${perfume.id},'work.created','{}')`;
    await c`insert into gallery_layouts(entity_type,entity_id,layout_data) values ('work',${perfume.id},'{}')`;
    expect(await deletePerfume(perfume.id)).toEqual({ id: perfume.id, cleanupPending: false });
    expect(await getPerfume(perfume.id)).toBeNull();
    for (const table of ["perfume_details", "perfume_variants", "catalogue_dates", "media", "work_credits", "perfume_notes"])
      expect(await c`select 1 from ${c(table)}`, table).toHaveLength(0);
    // People and organizations record their own activity; only this work's rows go.
    for (const table of ["comments", "activity_events", "gallery_layouts"])
      expect(await c`select 1 from ${c(table)} where entity_id=${perfume.id}`, table).toHaveLength(0);
    expect(mocks.deleteUnusedObjects).toHaveBeenCalledWith(
      { keys: [poster, thumb], prefixes: expect.arrayContaining(ownedPrefixes.work(perfume.id)) },
      `perfume ${perfume.id}`,
    );
    await expect(deletePerfume(perfume.id)).rejects.toThrow(/^Perfume not found$/);
  });

  it("filters, sorts and pages with counts that always match the results", async () => {
    const make = async (
      title: string,
      options: Omit<CreatePerfumeInput, "title"> & { variantPerfumer?: string; bottle?: "bottle" | "sample"; disposed?: boolean },
    ) => {
      const { variantPerfumer, bottle, disposed, ...input } = options;
      const perfume = await createPerfume({ ...input, title });
      if (variantPerfumer || bottle) {
        const variant = await createPerfumeVariant({
          workId: perfume.id,
          perfumers: variantPerfumer ? [{ personId: people[variantPerfumer] }] : null,
        });
        if (bottle) {
          const added = await addPerfumeBottle({ variantId: variant.id, container: bottle, capacityValue: 10, volumeUnit: "ml" });
          if (disposed)
            await updatePerfumeBottle(added.id, { status: "disposed", dispositionReason: "Used up" }, added.fingerprint);
        }
      }
      return perfume.id;
    };
    const chanel = [{ organizationId: orgs.chanel, role: "perfume_house" as const }];
    const guerlain = [{ organizationId: orgs.guerlain, role: "perfume_house" as const }];
    const ids = {
      no5: await make("No 5", { organizations: chanel, credits: [perfumer("beaux")], releaseDate: year(1921), notePyramid: [{ itemId: items.bergamot, position: "top" }, { itemId: items.rose, position: "heart" }], bottle: "bottle" }),
      cuir: await make("Cuir de Russie", { organizations: chanel, credits: [perfumer("beaux")], releaseDate: year(1925), bottle: "sample", disposed: true }),
      shalimar: await make("Shalimar", { organizations: guerlain, releaseDate: { precision: "range", start: { year: 1930 }, end: { year: 1935 } }, notePyramid: [{ itemId: items.bergamot, position: "top" }], bottle: "sample" }),
      mitsouko: await make("Mitsouko", { organizations: guerlain, variantPerfumer: "sheldrake", classificationItemIds: [items.floral] }),
      unknown: await make("Undated", {}),
    };
    await c`update works set is_favourite=true where id=${ids.mitsouko}`;
    await c`insert into works(title) values ('A book about perfume')`;
    const titles = async (q: PerfumeQuery) => (await getPerfumes({ ...q, limit: 200 })).map((p) => p.title);
    const cases: [PerfumeQuery, string[]][] = [
      [{}, ["Cuir de Russie", "Mitsouko", "No 5", "Shalimar", "Undated"]],
      [{ houseIds: [orgs.chanel] }, ["Cuir de Russie", "No 5"]],
      [{ perfumerIds: [people.sheldrake] }, ["Mitsouko"]],
      [{ taxonomyItemIds: [items.citrus] }, ["No 5", "Shalimar"]],
      [{ taxonomyItemIds: [items.citrus, items.rose] }, ["No 5"]],
      [{ taxonomyItemIds: [items.floral] }, ["Mitsouko"]],
      [{ releaseYearFrom: 1924, releaseYearTo: 1931 }, ["Cuir de Russie", "Shalimar"]],
      [{ releaseYearFrom: 1922 }, ["Cuir de Russie", "Shalimar"]],
      [{ holding: "owned" }, ["No 5", "Shalimar"]],
      [{ holding: "owned", containers: ["sample"] }, ["Shalimar"]],
      [{ holding: "not_owned" }, ["Cuir de Russie", "Mitsouko", "Undated"]],
      [{ search: "guerlain" }, ["Mitsouko", "Shalimar"]],
      [{ search: "shalimar" }, ["Shalimar"]],
      [{ favourite: true }, ["Mitsouko"]],
    ];
    for (const [q, expected] of cases) {
      expect(await titles(q), JSON.stringify(q)).toEqual(expected);
      expect(await getPerfumeCount(q), JSON.stringify(q)).toBe(expected.length);
    }
    // Known releases in date order; unknown releases last, in ID order.
    const byRelease = await titles({ sort: "release", order: "asc" });
    expect(byRelease.slice(0, 3)).toEqual(["No 5", "Cuir de Russie", "Shalimar"]);
    expect(byRelease.slice(3).sort()).toEqual(["Mitsouko", "Undated"]);
    for (const sort of ["title", "release", "recent", "rating"] as const) {
      const all = await titles({ sort });
      const paged: string[] = [];
      for (let offset = 0; offset < all.length; offset += 2)
        paged.push(...(await getPerfumes({ sort, limit: 2, offset })).map((p) => p.title));
      expect(paged, sort).toEqual(all);
    }
    const [card] = await getPerfumes({ search: "no 5" });
    expect(card).toMatchObject({
      title: "No 5",
      organizations: [expect.objectContaining({ name: "Chanel", role: "perfume_house" })],
      perfumers: [expect.objectContaining({ name: "Ernest Beaux" })],
      holdings: { bottles: 1, samples: 0, decants: 0, personallyOwned: true },
      releaseDate: expect.objectContaining({ precision: "year" }),
    });
    await expect(getPerfumes({ releaseYearFrom: 1950, releaseYearTo: 1900 })).rejects.toThrow();
    await expect(getPerfumes({ holding: "not_owned", containers: ["bottle"] })).rejects.toThrow();
    await expect(getPerfumes({ limit: 1000 })).rejects.toThrow();
  });

  it("keeps the date reference list equal to the database's foreign keys", async () => {
    const rows = await c`select kcu.table_name,kcu.column_name from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu on kcu.constraint_name=rc.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name=rc.unique_constraint_name
      where ccu.table_name='catalogue_dates' order by 1,2`;
    expect(rows.map((r) => [r.table_name, r.column_name])).toEqual(
      [...CATALOGUE_DATE_REFERENCES].map(([t, col]) => [t, col]).sort((a, b) => a.join().localeCompare(b.join())),
    );
  });

  it("exports perfumes one row each, and leaves other kinds out", async () => {
    const perfume = await fullPerfume();
    const variant = await createPerfumeVariant({ workId: perfume.id, concentration: "eau_de_parfum" });
    await addPerfumeBottle({ variantId: variant.id, container: "bottle", capacityValue: 100, volumeUnit: "ml" });
    await c`insert into works(title) values ('A book about perfume')`;
    const [row, ...more] = await collectionExportRows("perfumes", null);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({
      title: "No 5",
      houses: "Chanel",
      manufacturers: "Chanel",
      released: "1921",
      concentrations: "Eau de Parfum",
      top_notes: "bergamot",
      heart_notes: "rose",
      base_notes: "vanilla",
      bottles: 1,
      samples: 0,
      favourite: "no",
      description: "Aldehydic floral",
    });
    // The route names the file after the collection and refuses a closed one
    const response = await exportCatalogue(
      new NextRequest("http://localhost/api/export", {
        method: "POST",
        body: JSON.stringify({ entity: "perfumes", all: true, format: "csv" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/durtal-perfumes-all-/);
    expect(await response.text()).toContain("No 5");
  });
});
