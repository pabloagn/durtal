import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { z } from "zod";
import * as schema from "@/lib/db/schema";
import { ownedPrefixes } from "@/lib/s3/cleanup";

const url = process.env.DURTAL_PAINTING_SERVICES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln359_test")
    throw new Error("Painting service tests require disposable local sln359_test");
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
    artMovements: "ref:art-movements",
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
  createArtObject,
  createPainting,
  deleteArtObject,
  deletePainting,
  getArtObject,
  getPainting,
  getPaintingChoices,
  getPaintingCount,
  getPaintingFilterOptions,
  getPaintings,
  updateArtObject,
  updatePainting,
} from "@/lib/actions/paintings";
import { getWhereabouts, recordWhereabouts } from "@/lib/actions/whereabouts";
import { createPerson, getPersonMergePreview, mergePeople } from "@/lib/actions/people";
import { saveOrganization, deleteOrganization } from "@/lib/actions/organizations";
import { updateWorkCuration, getWorkCuration } from "@/lib/actions/curation";
import { STALE_RECORD } from "@/lib/catalogue/work-store";
import { collectionExportRows } from "@/lib/export/collections";
import type { CreatePaintingInput, PaintingQuery } from "@/lib/validations/paintings";

/** The whole message a caller sees; never SQL. */
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

describe.skipIf(!url)("paintings, originals, versions and reproductions", () => {
  const c = client!;
  let people: Record<string, string>;
  let orgs: Record<string, string>;
  let items: Record<string, string>;
  let movements: Record<string, string>;
  let home: string, cloud: string;
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });
  const range = (from: number, to: number) => ({
    precision: "range" as const,
    start: { year: from },
    end: { year: to },
    approximate: true,
  });
  const painter = (key: string) => ({ personId: people[key], roleId: "painting.painter" });
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await c`truncate works, authors, publishing_houses, venues, locations, custom_taxonomy_items, art_movements, catalogue_dates, comments, activity_events, gallery_layouts, harmonization_operations, harmonization_redirects cascade`;
    people = {};
    for (const [key, name] of [
      ["leonardo", "Leonardo da Vinci"],
      ["munch", "Edvard Munch"],
      ["vermeer", "Johannes Vermeer"],
    ])
      people[key] = (await createPerson({ name, domains: ["painting"] })).id;
    orgs = {};
    for (const [key, name] of [
      ["louvre", "Musée du Louvre"],
      ["nasjonal", "Nasjonalmuseet"],
      ["munchMuseum", "MUNCH"],
    ])
      orgs[key] = (await saveOrganization({ name, roles: ["museum"] }))!.id;
    const families = Object.fromEntries(
      (await c`select id,slug from taxonomy_families where slug in ('painting-genres','painting-techniques','painting-supports','perfume-families')`).map((r) => [r.slug, r.id]),
    );
    items = {};
    for (const [key, familySlug, parent] of [
      ["portrait", "painting-genres", null],
      ["landscape", "painting-genres", null],
      ["paint", "painting-techniques", null],
      ["tempera", "painting-techniques", "paint"],
      ["oil", "painting-techniques", "paint"],
      ["pastel", "painting-techniques", null],
      ["cardboard", "painting-supports", null],
      ["panel", "painting-supports", null],
      ["floral", "perfume-families", null],
    ] as const) {
      const [row] =
        await c`insert into custom_taxonomy_items(family_id,name,slug,parent_id) values (${families[familySlug]},${key},${key},${parent ? items[parent] : null}) returning id`;
      items[key] = row.id;
    }
    movements = Object.fromEntries(
      (await c`insert into art_movements(name,slug) values ('Renaissance','renaissance'),('Expressionism','expressionism') returning id,slug`).map((r) => [r.slug, r.id]),
    );
    [home, cloud] = (
      await c`insert into locations(name,type) values ('Home','physical'),('Cloud','digital') returning id`
    ).map((r) => r.id);
  });

  const monaLisa = () =>
    createPainting({
      title: "Mona Lisa",
      creationDate: range(1503, 1519),
      credits: [painter("leonardo")],
      classificationItemIds: [items.portrait, items.oil, items.panel],
      artMovementIds: [movements.renaissance],
    });
  const scream = () =>
    createPainting({
      title: "The Scream",
      creationDate: range(1893, 1910),
      credits: [painter("munch")],
      classificationItemIds: [items.cardboard],
      artMovementIds: [movements.expressionism],
    });

  it("curates a painting with no object, edition or copy", async () => {
    const painting = await monaLisa();
    expect(painting.creationDate?.value).toMatchObject({ precision: "range", approximate: true });
    expect(painting.credits.map((x) => x.personId)).toEqual([people.leonardo]);
    expect(painting.classification.map((x) => x.name).sort()).toEqual(["oil", "panel", "portrait"]);
    expect(painting.artMovements.map((x) => x.slug)).toEqual(["renaissance"]);
    expect(painting.objects).toEqual([]);
    expect(painting.holdings).toMatchObject({ personallyOwned: false, activeCount: 0 });
    expect(await c`select kind,original_language from works`).toEqual([{ kind: "painting", original_language: null }]);
    expect(await c`select id from editions`).toHaveLength(0);
    expect(await c`select id from instances`).toHaveLength(0);
    expect(mocks.invalidate).toHaveBeenCalledWith("data:works", "ref:authors", "ref:custom-taxonomy-items", "ref:art-movements");
  });

  it("keeps several originals and versions distinct, with explicit attribution", async () => {
    const painting = await scream();
    const tempera = await createArtObject({
      workId: painting.id, kind: "original", label: "1893 tempera", creationDate: year(1893),
      height: 91, width: 73.5, dimensionUnit: "cm", classificationItemIds: [items.tempera],
      ownership: "institutional", ownerOrganizationId: orgs.nasjonal, collectionName: "Old Masters and Modern", accessionNumber: "NG.M.00939",
    });
    const late = await createArtObject({
      workId: painting.id, kind: "original", label: "1910 tempera", creationDate: year(1910),
      ownership: "institutional", ownerOrganizationId: orgs.munchMuseum, accessionNumber: "MM.M.00514",
    });
    const crayon = await createArtObject({
      workId: painting.id, kind: "version", label: "1893 crayon", classificationItemIds: [items.pastel],
      attribution: [{ personId: people.munch, attribution: "confirmed" }],
    });
    expect(tempera).toMatchObject({ heightCm: 91, widthCm: 73.5, ownerName: "Nasjonalmuseet", accessionNumber: "NG.M.00939" });
    // Own technique replaces the painting's; the painting's support is inherited.
    expect(tempera.classification.map((t) => [t.name, t.inherited])).toEqual([["cardboard", true], ["tempera", false]]);
    expect(tempera.attribution).toEqual([expect.objectContaining({ personId: people.munch, inherited: true })]);
    expect(crayon.attribution).toEqual([expect.objectContaining({ personId: people.munch, attribution: "confirmed", inherited: false })]);
    expect(await failure(createArtObject({ workId: painting.id, kind: "version", label: "1893 tempera" }))).toBe(
      "This painting already has an original or version with this label",
    );
    await createArtObject({ workId: painting.id, kind: "version" });
    expect(await failure(createArtObject({ workId: painting.id, kind: "original" }))).toBe(
      "Label each original or version when the painting has more than one",
    );
    const all = (await getPainting(painting.id))!;
    expect(all.objects.map((o) => [o.kind, o.label])).toEqual([
      ["original", "1893 tempera"],
      ["original", "1910 tempera"],
      ["version", "1893 crayon"],
      ["version", null],
    ]);
    await expect(
      c`delete from taxonomy_applicability where kind='painting' and level='art_object' and family_id=(select family_id from custom_taxonomy_items where id=${items.tempera})`,
    ).rejects.toThrow("Remove or reassign taxonomy links before removing this scope");
    const restored = await updateArtObject(crayon.id, { attribution: null }, crayon.fingerprint);
    expect(restored.attribution).toEqual([expect.objectContaining({ personId: people.munch, inherited: true })]);
    expect(restored.attributionOverride).toBe(false);
    expect(await failure(updateArtObject(late.id, { label: "1893 tempera" }, late.fingerprint))).toBe(
      "This painting already has an original or version with this label",
    );
  });

  it("scopes accession numbers to their institution", async () => {
    const painting = await monaLisa();
    await createArtObject({ workId: painting.id, kind: "original", label: "Louvre", ownership: "institutional", ownerOrganizationId: orgs.louvre, accessionNumber: "INV 779" });
    await createArtObject({ workId: painting.id, kind: "version", label: "Oslo copy", ownership: "institutional", ownerOrganizationId: orgs.nasjonal, accessionNumber: "INV 779" });
    expect(
      await failure(createArtObject({ workId: painting.id, kind: "version", label: "Other", ownership: "institutional", ownerOrganizationId: orgs.louvre, accessionNumber: " inv 779" })),
    ).toBe("This institution already uses this accession number");
    await expect(deleteOrganization(orgs.louvre)).rejects.toThrow();
  });

  it("records unknown painters and dimensions without placeholders", async () => {
    const painting = await createPainting({
      title: "Portrait of a Man",
      credits: [{ personId: null, roleId: "painting.painter", attribution: "unknown" }],
    });
    const object = await createArtObject({ workId: painting.id, kind: "original" });
    expect(object).toMatchObject({ height: null, width: null, dimensionUnit: null, heightCm: null, ownership: "unknown" });
    expect(object.attribution).toEqual([expect.objectContaining({ personId: null, attribution: "unknown", inherited: true })]);
    expect(await failure(createArtObject({ workId: painting.id, kind: "version", label: "A", dimensionUnit: "cm" }))).toBe("A unit needs a dimension");
    expect(await failure(createArtObject({ workId: painting.id, kind: "version", label: "A", height: 10 }))).toBe("Choose a unit for the dimensions");
    const inches = await createArtObject({ workId: painting.id, kind: "version", label: "Small", height: 10, width: 8, dimensionUnit: "in" });
    expect(inches).toMatchObject({ heightCm: 25.4, widthCm: 20.32 });
  });

  it("keeps reproductions independent of the original and personal ownership explicit", async () => {
    const painting = await scream();
    const other = await monaLisa();
    const otherOriginal = await createArtObject({ workId: other.id, kind: "original" });
    const original = await createArtObject({ workId: painting.id, kind: "original", label: "1893 tempera", ownership: "institutional", ownerOrganizationId: orgs.nasjonal });
    const poster = await createArtObject({
      workId: painting.id, kind: "reproduction", label: "Museum poster", reproducesObjectId: original.id,
      ownership: "personal", holdingStatus: "held", locationId: home, acquisitionDate: year(2015), acquisitionPrice: 20, acquisitionCurrency: "NOK",
    });
    expect(poster).toMatchObject({ kind: "reproduction", locationName: "Home", holdingStatus: "held" });
    expect((await getArtObject(original.id))!.fingerprint).toBe(original.fingerprint);
    expect((await getPainting(painting.id))!.holdings).toMatchObject({ personallyOwned: true, reproductions: 1, originals: 0 });
    // Reproductions need no unique label: two copies of one poster are two objects.
    const second = await createArtObject({ workId: painting.id, kind: "reproduction", label: "Museum poster", ownership: "personal", holdingStatus: "held" });
    expect(await failure(createArtObject({ workId: painting.id, kind: "reproduction", reproducesObjectId: poster.id }))).toBe(
      "A reproduction reproduces an original or version of the same painting",
    );
    expect(await failure(createArtObject({ workId: painting.id, kind: "reproduction", reproducesObjectId: otherOriginal.id }))).toBe(
      "A reproduction reproduces an original or version of the same painting",
    );
    expect(await failure(createArtObject({ workId: painting.id, kind: "original", label: "X", reproducesObjectId: original.id }))).toBe(
      "Only a reproduction reproduces another object",
    );
    expect(await failure(updateArtObject(original.id, { kind: "reproduction" }, original.fingerprint))).toBe(
      "Reproductions refer to this object; it must stay an original or version",
    );
    expect(await failure(deleteArtObject(original.id))).toBe("Reproductions refer to this object; change or delete them first");
    expect(await failure(deletePainting(painting.id))).toBe("Delete or reassign the objects you own of this painting first");

    const given = await updateArtObject(poster.id, { holdingStatus: "disposed", dispositionReason: "Gift" }, poster.fingerprint);
    expect(given.holdingStatus).toBe("disposed");
    expect((await getPainting(painting.id))!.holdings.personallyOwned).toBe(true);
    await deleteArtObject(second.id);
    expect((await getPainting(painting.id))!.holdings).toMatchObject({ personallyOwned: false, disposedCount: 1 });
    await deleteArtObject(poster.id);
    expect(await c`select id from catalogue_dates where id=${poster.acquisitionDateId}`).toHaveLength(0);
    await c`insert into comments(entity_type,entity_id,content_html) values ('work',${painting.id},'<p>Note</p>')`;
    expect(await deletePainting(painting.id)).toEqual({ id: painting.id, cleanupPending: false });
    expect(await c`select 1 from art_objects where work_id=${painting.id}`).toHaveLength(0);
    expect(await c`select 1 from comments where entity_id=${painting.id}`).toHaveLength(0);
    expect(mocks.deleteUnusedObjects).toHaveBeenCalledWith(
      { keys: [], prefixes: expect.arrayContaining(ownedPrefixes.work(painting.id)) },
      `painting ${painting.id}`,
    );
  });

  it("validates ownership, storage and classification scope", async () => {
    const painting = await monaLisa();
    const cases: [object, string][] = [
      [{ ownership: "institutional" }, "An institutional owner names its organization, and only then"],
      [{ ownership: "private", ownerOrganizationId: orgs.louvre }, "An institutional owner names its organization, and only then"],
      [{ ownership: "private", accessionNumber: "A1" }, "A collection and accession number belong to an institutional owner"],
      [{ ownership: "unknown", ownerLabel: "Someone" }, "Describe an owner only for a private collection"],
      [{ ownership: "institutional", ownerOrganizationId: orgs.louvre, locationId: home }, "Storage, acquisition and disposition belong to personal objects"],
      [{ ownership: "personal" }, "A personally owned object has a holding status, and only then"],
      [{ ownership: "personal", holdingStatus: "held", acquisitionPrice: 5 }, "Price and currency must be supplied together"],
    ];
    for (const [input, message] of cases)
      expect(await failure(createArtObject({ workId: painting.id, kind: "reproduction", ...input })), message).toBe(message);
    expect(await failure(createArtObject({ workId: painting.id, kind: "reproduction", ownership: "personal", holdingStatus: "held", locationId: cloud }))).toBe(
      "Artworks require a physical personal location",
    );
    expect(await failure(createArtObject({ workId: painting.id, kind: "reproduction", classificationItemIds: [items.portrait] }))).toBe(
      "Technique, medium or support: this classification does not apply to painting objects",
    );
    expect(await failure(createPainting({ title: "Wrong", classificationItemIds: [items.floral] }))).toBe(
      "Taxonomy family does not apply to this domain and record level",
    );
    const privately = await createArtObject({ workId: painting.id, kind: "version", label: "Isleworth", ownership: "private", ownerLabel: "Private collection, Switzerland" });
    expect(privately).toMatchObject({ ownerName: null, ownerLabel: "Private collection, Switzerland" });
    expect(await c`select 1 from works where title='Wrong'`).toHaveLength(0);
  });

  it("replaces only supplied sections and keeps curation apart", async () => {
    const painting = await monaLisa();
    await updateWorkCuration({
      owner: { kind: "painting", id: painting.id },
      patch: { rating: 5, isFavourite: true },
      fingerprint: (await getWorkCuration({ kind: "painting", id: painting.id }))!.fingerprint,
    });
    expect((await getPainting(painting.id))!.fingerprint).toBe(painting.fingerprint);
    const object = await createArtObject({ workId: painting.id, kind: "original", label: "Louvre" });
    expect((await getPainting(painting.id))!.fingerprint).toBe(painting.fingerprint);
    const updated = await updatePainting(painting.id, { artMovementIds: [], creationDate: year(1503) }, painting.fingerprint);
    expect(updated.artMovements).toEqual([]);
    expect(updated.credits.map((x) => x.id)).toEqual(painting.credits.map((x) => x.id));
    expect(updated.classification).toHaveLength(3);
    expect(updated.curation).toMatchObject({ rating: 5, isFavourite: true });
    expect(await c`select id from catalogue_dates`).toHaveLength(1);
    expect(await failure(updatePainting(painting.id, { title: "Lost" }, painting.fingerprint))).toBe(STALE_RECORD);
    const results = await Promise.allSettled(
      ["A", "B", "C"].map((height) => updateArtObject(object.id, { height: height.charCodeAt(0), dimensionUnit: "cm" }, object.fingerprint)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("keeps object attribution through a person merge", async () => {
    const painting = await monaLisa();
    const twin = await createPerson({ name: "Leonardo", domains: ["painting"] });
    const object = await createArtObject({ workId: painting.id, kind: "version", label: "Workshop", attribution: [{ personId: twin.id, creditedAs: "Workshop of Leonardo", attribution: "attributed" }] });
    const preview = await getPersonMergePreview(twin.id, people.leonardo);
    await mergePeople({
      sourceId: twin.id, targetId: people.leonardo, fingerprint: preview.fingerprint,
      choices: Object.fromEntries(preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target" as const])),
    });
    expect((await getArtObject(object.id))!.attribution).toEqual([
      expect.objectContaining({ id: object.attribution[0].id, personId: people.leonardo, creditedAs: "Workshop of Leonardo" }),
    ]);
  });

  it("filters, sorts and pages with counts that always match the results", async () => {
    const make = async (title: string, input: Omit<CreatePaintingInput, "title">, owned = false, owner?: string) => {
      const painting = await createPainting({ ...input, title });
      if (owner) await createArtObject({ workId: painting.id, kind: "original", label: "Main", ownership: "institutional", ownerOrganizationId: owner, height: 77, width: 53, dimensionUnit: "cm" });
      if (owned) await createArtObject({ workId: painting.id, kind: "reproduction", ownership: "personal", holdingStatus: "held" });
      return painting.id;
    };
    const mona = await make("Mona Lisa", { creationDate: range(1503, 1519), credits: [painter("leonardo")], classificationItemIds: [items.portrait, items.oil], artMovementIds: [movements.renaissance] }, true, orgs.louvre);
    await make("The Scream", { creationDate: year(1893), credits: [painter("munch")], artMovementIds: [movements.expressionism] }, false, orgs.nasjonal);
    await make("The Milkmaid", { creationDate: year(1658), credits: [painter("vermeer")], classificationItemIds: [items.oil] });
    const unknown = await make("Unknown Landscape", { classificationItemIds: [items.landscape] });
    await createArtObject({ workId: unknown, kind: "version", label: "Attributed", classificationItemIds: [items.tempera], attribution: [{ personId: people.munch, attribution: "attributed" }] });
    await c`update works set is_favourite=true where id=${mona}`;
    await c`insert into works(title) values ('A book about paintings')`;
    const titles = async (q: PaintingQuery) => (await getPaintings({ ...q, limit: 200 })).map((p) => p.title);
    const cases: [PaintingQuery, string[]][] = [
      [{}, ["Mona Lisa", "The Milkmaid", "The Scream", "Unknown Landscape"]],
      [{ painterIds: [people.munch] }, ["The Scream", "Unknown Landscape"]],
      [{ taxonomyItemIds: [items.paint] }, ["Mona Lisa", "The Milkmaid", "Unknown Landscape"]],
      [{ taxonomyItemIds: [items.paint, items.portrait] }, ["Mona Lisa"]],
      [{ artMovementIds: [movements.expressionism, movements.renaissance] }, ["Mona Lisa", "The Scream"]],
      [{ ownerOrganizationIds: [orgs.nasjonal] }, ["The Scream"]],
      [{ createdFrom: 1510, createdTo: 1700 }, ["Mona Lisa", "The Milkmaid"]],
      [{ holding: "owned" }, ["Mona Lisa"]],
      [{ holding: "not_owned" }, ["The Milkmaid", "The Scream", "Unknown Landscape"]],
      [{ search: "milkmaid" }, ["The Milkmaid"]],
      [{ favourite: true }, ["Mona Lisa"]],
    ];
    for (const [q, expected] of cases) {
      expect(await titles(q), JSON.stringify(q)).toEqual(expected);
      expect(await getPaintingCount(q), JSON.stringify(q)).toBe(expected.length);
    }
    expect((await titles({ sort: "created", order: "asc" })).slice(0, 3)).toEqual(["Mona Lisa", "The Milkmaid", "The Scream"]);
    for (const sort of ["title", "created", "recent", "rating"] as const) {
      const all = await titles({ sort });
      const paged: string[] = [];
      for (let offset = 0; offset < all.length; offset += 2)
        paged.push(...(await getPaintings({ sort, limit: 2, offset })).map((p) => p.title));
      expect(paged, sort).toEqual(all);
    }
    const [card] = await getPaintings({ search: "mona" });
    expect(card).toMatchObject({
      painters: [expect.objectContaining({ name: "Leonardo da Vinci" })],
      primaryObject: expect.objectContaining({ kind: "original", owner: "Musée du Louvre", heightCm: 77, widthCm: 53 }),
      personalCount: 1,
    });
    await expect(getPaintings({ createdFrom: 1900, createdTo: 1800 })).rejects.toThrow();
  });

  it("lists the home's filter options with the paintings each matches", async () => {
    const mona = await monaLisa();
    await scream();
    const original = await createArtObject({ workId: mona.id, kind: "original", ownership: "institutional", ownerOrganizationId: orgs.louvre });
    await createArtObject({
      workId: mona.id,
      kind: "version",
      label: "Isleworth",
      classificationItemIds: [items.tempera],
      attribution: [{ personId: people.vermeer, attribution: "uncertain" }],
    });
    const [venue] = await c`insert into venues(name,slug,type) values ('Musée du Louvre','louvre','museum') returning id`;
    await recordWhereabouts(
      { objectId: original.id, placeKind: "venue", venueId: venue.id, custody: "permanent_collection", displayStatus: "on_display", certainty: "confirmed" },
      (await getWhereabouts(original.id))!.fingerprint,
    );
    await c`insert into works(title) values ('A book about paintings')`;
    const options = await getPaintingFilterOptions();
    const named = (rows: { name: string; count: number }[]) =>
      rows.map((r) => [r.name, r.count]).sort(([a], [b]) => String(a).localeCompare(String(b)));
    expect(named(options.painters)).toEqual([["Edvard Munch", 1], ["Johannes Vermeer", 1], ["Leonardo da Vinci", 1]]);
    expect(named(options.movements)).toEqual([["Expressionism", 1], ["Renaissance", 1]]);
    expect(named(options.genres)).toEqual([["portrait", 1]]);
    // A broader technique counts the paintings of its narrower ones, objects included
    expect(named(options.techniques)).toEqual([["oil", 1], ["paint", 1], ["tempera", 1]]);
    expect(options.techniques.find((t) => t.name === "oil")?.parentName).toBe("paint");
    expect(named(options.supports)).toEqual([["cardboard", 1], ["panel", 1]]);
    expect(named(options.institutions)).toEqual([["Musée du Louvre", 1]]);
    expect(named(options.venues)).toEqual([["Musée du Louvre", 1]]);
    expect(options.creationYears).toEqual({ min: 1503, max: 1910 });
    expect((await getPaintingChoices()).movements.map((m) => m.name)).toEqual(["Expressionism", "Renaissance"]);
  });

  it("exports paintings one row each, with the original's owner and size", async () => {
    const mona = await monaLisa();
    await createArtObject({ workId: mona.id, kind: "original", ownership: "institutional", ownerOrganizationId: orgs.louvre, height: 77, width: 53, dimensionUnit: "cm" });
    await c`insert into works(title) values ('Mona Lisa')`;
    const [row, ...more] = await collectionExportRows("paintings", null);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({
      title: "Mona Lisa",
      painters: "Leonardo da Vinci",
      movements: "Renaissance",
      genres: "portrait",
      techniques: "oil",
      supports: "panel",
      original: "Original",
      original_owner: "Musée du Louvre",
      height_cm: 77,
      width_cm: 53,
      objects_owned: 0,
    });
    expect(row.painted).toContain("1503");
  });
});
