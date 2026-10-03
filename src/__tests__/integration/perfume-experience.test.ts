import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_PERFUME_EXPERIENCE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln366_test")
    throw new Error("Perfume experience tests require disposable local sln366_test");
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
  CACHE_TAGS: new Proxy({}, { get: (_, key) => String(key) }),
}));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import {
  addPerfumeBottle,
  createPerfume,
  createPerfumeVariant,
  getPerfume,
  getPerfumeCount,
  getPerfumeFilterOptions,
  getPerfumes,
  getRelatedPerfumes,
  updatePerfume,
} from "@/lib/actions/perfumes";
import { createPerson } from "@/lib/actions/people";
import { saveOrganization } from "@/lib/actions/organizations";
import { addPerfumeRetailerLink } from "@/lib/actions/perfume-retailers";
import {
  citeSource,
  deleteCitedSource,
  recordSourceObservation,
} from "@/lib/actions/catalogue-provenance";

describe.skipIf(!url)("perfume screens: services they need", () => {
  const c = client!;
  let people: Record<string, string>;
  let orgs: Record<string, string>;
  let items: Record<string, string>;
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, venues, locations, custom_taxonomy_items, catalogue_dates, media, source_records cascade`;
    people = {};
    for (const [key, name] of [
      ["guerlain", "Jacques Guerlain"],
      ["polge", "Jacques Polge"],
    ])
      people[key] = (await createPerson({ name, domains: ["perfume"] })).id;
    orgs = {};
    for (const [key, name, roles] of [
      ["guerlain", "Guerlain", ["perfume_house"]],
      ["chanel", "Chanel", ["perfume_house"]],
      // A publisher that has never been a perfume house or a retailer
      ["gallimard", "Gallimard", ["publisher"]],
    ] as const)
      orgs[key] = (await saveOrganization({ name, roles: [...roles] }))!.id;
    const families = Object.fromEntries(
      (await c`select id,slug from taxonomy_families where slug like 'perfume-%'`).map((r) => [r.slug, r.id]),
    );
    items = {};
    for (const [key, familySlug, parent] of [
      ["oriental", "perfume-families", null],
      ["amber", "perfume-families", "oriental"],
      ["powdery", "perfume-accords", null],
      ["iris", "perfume-notes", null],
      ["vanilla", "perfume-notes", null],
      ["bergamot", "perfume-notes", null],
      ["rose", "perfume-notes", null],
    ] as const) {
      const [row] =
        await c`insert into custom_taxonomy_items(family_id,name,slug,parent_id) values (${families[familySlug]},${key},${key},${parent ? items[parent] : null}) returning id`;
      items[key] = row.id;
    }
  });

  const house = (key: string) => ({ organizationId: orgs[key], role: "perfume_house" as const });
  const perfumer = (key: string) => ({ personId: people[key], roleId: "perfume.perfumer" });
  const notes = (...keys: string[]) =>
    keys.map((key) => ({ itemId: items[key], position: "heart" as const }));

  it("gives a new perfume a readable address, numbered when taken", async () => {
    const first = await createPerfume({ title: "Shalimar", organizations: [house("guerlain")] });
    const second = await createPerfume({ title: "Shalimar", organizations: [house("guerlain")] });
    const plain = await createPerfume({ title: "Shalimar" });
    expect([first.slug, second.slug, plain.slug]).toEqual([
      "shalimar-by-guerlain",
      "shalimar-by-guerlain-2",
      "shalimar",
    ]);
    // An edit keeps the address: links to the perfume keep working
    const renamed = await updatePerfume(first.id, { title: "Shalimar Parfum" }, first.fingerprint);
    expect(renamed.slug).toBe("shalimar-by-guerlain");
  });

  it("gives an organization the perfume role the user chose, in the same write", async () => {
    // Gallimard is named as a brand and as a bottle's supplier
    const perfume = await createPerfume({
      title: "Vol de Nuit",
      organizations: [house("guerlain"), { organizationId: orgs.gallimard, role: "brand" }],
    });
    const variant = await createPerfumeVariant({ workId: perfume.id, concentration: "extrait" });
    await addPerfumeBottle({
      variantId: variant.id,
      container: "bottle",
      capacityValue: 30,
      volumeUnit: "ml",
      supplierId: orgs.gallimard,
    });
    await addPerfumeRetailerLink({
      workId: perfume.id,
      organizationId: orgs.chanel,
      url: "https://example.com/vol-de-nuit",
    });
    const roles = await c`select organization_id,role from organization_roles order by role`;
    expect(roles.filter((r) => r.organization_id === orgs.gallimard).map((r) => r.role)).toEqual([
      "brand",
      "retailer",
    ]);
    expect(roles.filter((r) => r.organization_id === orgs.chanel).map((r) => r.role)).toEqual([
      "perfume_house",
      "retailer",
    ]);
    // The book profile is untouched
    const [gallimard] = await c`select kind from publishing_houses where id=${orgs.gallimard}`;
    expect(gallimard.kind).toBe("publisher");
  });

  it("filters by concentration, and loads card data in one query", async () => {
    const shalimar = await createPerfume({ title: "Shalimar", organizations: [house("guerlain")] });
    const jicky = await createPerfume({ title: "Jicky", organizations: [house("guerlain")] });
    await createPerfumeVariant({ workId: shalimar.id, concentration: "eau_de_parfum" });
    await createPerfumeVariant({ workId: shalimar.id, concentration: "extrait" });
    await createPerfumeVariant({ workId: jicky.id, concentration: "eau_de_toilette" });
    const extraits = await getPerfumes({ concentrations: ["extrait", "parfum"] });
    expect(extraits.map((p) => p.title)).toEqual(["Shalimar"]);
    expect(await getPerfumeCount({ concentrations: ["eau_de_toilette"] })).toBe(1);
    expect(extraits[0].formulations).toEqual([
      { concentration: "eau_de_parfum", concentrationLabel: null },
      { concentration: "extrait", concentrationLabel: null },
    ]);
    await c`insert into media(work_id,type,s3_key,is_active,color_palette) values (${shalimar.id},'poster','works/s.webp',true,${JSON.stringify({ dominant: { hex: "#7a5c3e" } })}::jsonb)`;
    const [card] = await getPerfumes({ search: "shalimar" });
    expect(card.poster).toMatchObject({ s3Key: "works/s.webp", tone: "#7a5c3e" });
  });

  it("offers only the filter values perfumes use, with their broader items", async () => {
    const shalimar = await createPerfume({
      title: "Shalimar",
      releaseDate: year(1925),
      organizations: [house("guerlain")],
      credits: [perfumer("guerlain")],
      notePyramid: notes("iris", "vanilla"),
      classificationItemIds: [items.amber, items.powdery],
    });
    const variant = await createPerfumeVariant({
      workId: shalimar.id,
      concentration: "extrait",
      perfumers: [{ personId: people.polge }],
      releaseDate: year(1990),
    });
    expect(variant.perfumers.map((p) => p.personId)).toEqual([people.polge]);
    await createPerfume({ title: "Unreleased", releaseDate: { precision: "range", start: { year: 1880 }, end: { year: 1885 } } });
    const options = await getPerfumeFilterOptions();
    expect(options.houses).toEqual([{ id: orgs.guerlain, name: "Guerlain", count: 1 }]);
    expect(options.perfumers.map((p) => [p.name, p.count])).toEqual([
      ["Jacques Guerlain", 1],
      ["Jacques Polge", 1],
    ]);
    // Amber brings its broader family, Oriental; unused notes are not offered
    expect(options.families.map((f) => [f.name, f.parentName])).toEqual([
      ["oriental", null],
      ["amber", "oriental"],
    ]);
    expect(options.accords.map((a) => a.name)).toEqual(["powdery"]);
    expect(options.notes.map((n) => n.name)).toEqual(["iris", "vanilla"]);
    expect(options.concentrations).toEqual(["extrait"]);
    expect(options.releaseYears).toEqual({ min: 1880, max: 1925 });
  });

  it("finds related fragrances by house, perfumer and shared notes, each once", async () => {
    const make = (title: string, extra: object) =>
      createPerfume({ title, ...extra });
    const shalimar = await make("Shalimar", {
      organizations: [house("guerlain")],
      credits: [perfumer("guerlain")],
      notePyramid: notes("iris", "vanilla", "bergamot"),
    });
    const jicky = await make("Jicky", { organizations: [house("guerlain")], notePyramid: notes("iris", "vanilla") });
    const mitsouko = await make("Mitsouko", { organizations: [house("chanel")], credits: [perfumer("guerlain")] });
    const no19 = await make("No 19", {
      organizations: [house("chanel")],
      notePyramid: notes("iris", "vanilla", "bergamot"),
    });
    await make("Rose only", { organizations: [house("chanel")], notePyramid: notes("rose", "iris") });
    const related = await getRelatedPerfumes(shalimar.id);
    expect(related.house).toMatchObject({ id: orgs.guerlain, name: "Guerlain" });
    expect(related.house!.perfumes.map((p) => p.id)).toEqual([jicky.id]);
    expect(related.perfumer!.perfumes.map((p) => p.id)).toEqual([mitsouko.id]);
    // Jicky shares two notes but is already in the house row
    expect(related.similar.map((p) => [p.id, p.shared])).toEqual([
      [no19.id, ["bergamot", "iris", "vanilla"]],
    ]);
  });

  it("shows a formulation's own image", async () => {
    const perfume = await createPerfume({ title: "Mitsouko" });
    const variant = await createPerfumeVariant({ workId: perfume.id, concentration: "parfum" });
    await c`insert into media(perfume_variant_id,type,s3_key,is_active,color_palette) values
      (${variant.id},'poster','variants/old.webp',false,null),
      (${variant.id},'poster','variants/new.webp',true,${JSON.stringify({ dominant: { hex: "#223344" } })}::jsonb)`;
    const [loaded] = (await getPerfume(perfume.id))!.variants;
    expect(loaded.image).toEqual({ s3Key: "variants/new.webp", thumbnailS3Key: null, tone: "#223344" });
  });

  it("records a source the user cites, and removes it only while nothing cites it", async () => {
    const perfume = await createPerfume({ title: "Shalimar" });
    const owner = { kind: "perfume" as const, id: perfume.id };
    const site = await citeSource({
      owner,
      url: "https://www.fragrantica.com/perfume/Guerlain/Shalimar-1.html",
      attribution: "Fragrantica",
      retrievedOn: "2026-10-01",
      note: "Release year",
    });
    const book = await citeSource({ owner, attribution: "Perfume Legends, p. 42", retrievedOn: "2026-09-30" });
    expect(site).toMatchObject({ provider: "fragrantica.com", reviewStatus: "accepted", payload: { entry: "manual", note: "Release year" } });
    expect(site.verifiedAt!.getTime()).toBeGreaterThanOrEqual(site.retrievedAt.getTime());
    expect(book).toMatchObject({ provider: "manual", url: null, payload: { entry: "manual" } });
    await expect(
      citeSource({ owner, attribution: "Later", retrievedOn: "2999-01-01" }),
    ).rejects.toThrow("The day consulted cannot be in the future");
    // The dates cite the site: it stays until another source is chosen
    const cited = await updatePerfume(perfume.id, { sourceRecordId: site.id }, perfume.fingerprint);
    await expect(deleteCitedSource(site.id)).rejects.toThrow(
      "A record still cites this source; choose another source there first",
    );
    await updatePerfume(perfume.id, { sourceRecordId: null }, cited.fingerprint);
    expect(await deleteCitedSource(site.id)).toEqual({ id: site.id });
    // A provider's observation is not the user's to remove here
    const provider = await recordSourceObservation({
      owner,
      provider: "wikidata",
      retrievedAt: new Date("2026-09-01T00:00:00Z"),
      payload: { qid: "Q1" },
    });
    await expect(deleteCitedSource(provider.id)).rejects.toThrow(
      "Only an unlocked source you cited can be removed",
    );
    expect((await c`select id from source_records order by provider`).map((r) => r.id)).toEqual([
      book.id,
      provider.id,
    ]);
  });
});
