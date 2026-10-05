import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_INTERCHANGE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln375_interchange")
    throw new Error("Interchange tests require disposable local sln375_interchange");
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
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), cached: (fn: unknown) => fn, CACHE_TAGS: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import { exportInterchange } from "@/lib/interchange/export";
import { importInterchange } from "@/lib/interchange/import";
import { InterchangeFileError, type InterchangeDocument } from "@/lib/interchange/format";
import { TABLES } from "@/lib/interchange/tables";
import { createPerson } from "@/lib/actions/people";
import { saveOrganization } from "@/lib/actions/organizations";
import { createVenue } from "@/lib/actions/venues";
import { createTaxonomyItem } from "@/lib/actions/taxonomy-families";
import { addPerfumeBottle, createPerfume, createPerfumeVariant } from "@/lib/actions/perfumes";
import { createFilm, createFilmVersion } from "@/lib/actions/films";
import { createArtObject, createPainting } from "@/lib/actions/paintings";
import { getWhereabouts, recordWhereabouts } from "@/lib/actions/whereabouts";
import { createWorkRelation } from "@/lib/actions/work-relations";
import { bulkAddWorksToCollection, createCollection } from "@/lib/actions/collections";
import { citeSource } from "@/lib/actions/catalogue-provenance";
import { getWorkCuration, updateWorkCuration } from "@/lib/actions/curation";
import { fetchProviderDetail, providerLocks, recordProviderDetail, reviewProposal } from "@/lib/providers/run";
import type { ProviderAdapter } from "@/lib/providers/contract";

describe.skipIf(!url)("the Durtal interchange file", () => {
  const c = client!;
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });
  const value = async <T = string>(text: string, params: unknown[] = []) =>
    Object.values((await c.unsafe(text, params as postgres.ParameterOrJSON<never>[]))[0] ?? {})[0] as T;
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const recordOf = (doc: InterchangeDocument, domain: string) => doc.records.find((r) => r.domain === domain)!;
  const outcomes = (report: Awaited<ReturnType<typeof importInterchange>>) =>
    Object.fromEntries(report.records.map((r) => [r.domain, r.outcome]));
  /** Rows of every table the format carries */
  const tableCounts = async () => {
    const out: Record<string, number> = {};
    for (const name of TABLES.keys()) out[name] = await value<number>(`select count(*)::int from ${name}`);
    return out;
  };
  const wipe = () =>
    c.unsafe(`truncate works, authors, publishing_houses, venues, places, locations, catalogue_dates, collections, series,
      recommenders, source_records, catalogue_identifiers, custom_taxonomy_items, activity_events, comments, gallery_layouts,
      harmonization_operations, harmonization_redirects cascade`);
  const strip = (doc: InterchangeDocument) => ({ ...doc, exportedAt: null });

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    await client?.end();
  });
  beforeEach(async () => {
    await wipe();
    // No step of an import or export may reach for the network
    vi.stubGlobal("fetch", () => {
      throw new Error("No network in these tests");
    });
  });

  let ids: Record<string, string>;
  /** One record of each collection, linked and collected together */
  async function library() {
    ids = {};
    const burgess = await value(`insert into authors(name, slug) values ('Anthony Burgess', 'anthony-burgess') returning id`);
    ids.book = await value(`insert into works(title, slug, original_language, original_year) values ('A Clockwork Orange', 'a-clockwork-orange', 'en', 1962) returning id`);
    await c`insert into work_authors(work_id, author_id, role, sort_order) values (${ids.book}, ${burgess}, 'author', 0)`;
    ids.firstEdition = await value(`insert into editions(work_id, title, isbn_13, publication_year) values ($1, 'A Clockwork Orange', '9780434098001', 1962) returning id`, [ids.book]);
    ids.chosenEdition = await value(`insert into editions(work_id, title, isbn_13, publication_year) values ($1, 'A Clockwork Orange (Restored)', '9780393341768', 2012) returning id`, [ids.book]);
    const study = await value(`insert into locations(name, type) values ('Study', 'physical') returning id`);
    await c`insert into instances(edition_id, location_id, format) values (${ids.chosenEdition}, ${study}, 'paperback')`;

    const beaux = (await createPerson({ name: "Ernest Beaux", domains: ["perfume"] })).id;
    const kubrick = (await createPerson({ name: "Stanley Kubrick", domains: ["film"] })).id;
    const vermeer = (await createPerson({ name: "Johannes Vermeer", domains: ["painting"] })).id;
    const chanel = (await saveOrganization({ name: "Chanel", roles: ["perfume_house"] }))!.id;
    const mauritshuis = (await saveOrganization({ name: "Mauritshuis", roles: ["museum"] }))!.id;
    const hague = (await createVenue({ name: "Mauritshuis, The Hague", type: "museum" })).id;
    const tokyo = (await createVenue({ name: "Tokyo Metropolitan Art Museum", type: "museum" })).id;
    ids.tokyo = tokyo;

    const bergamot = await createTaxonomyItem("perfume-notes", { name: "Bergamot" });
    ids.bergamot = bergamot.id;
    const perfume = await createPerfume({
      title: "No 5",
      releaseDate: year(1921),
      organizations: [{ organizationId: chanel, role: "perfume_house" }],
      credits: [{ personId: beaux, roleId: "perfume.perfumer" }],
      notePyramid: [{ itemId: bergamot.id, position: "top" }],
    });
    ids.perfume = perfume.id;
    const parfum = await createPerfumeVariant({ workId: perfume.id, concentration: "parfum" });
    await addPerfumeBottle({ variantId: parfum.id, container: "bottle", capacityValue: 30, volumeUnit: "ml", locationId: study });
    ids.source = (await citeSource({ owner: { kind: "perfume", id: perfume.id }, url: "https://example.org/no-5", attribution: "House archive", retrievedOn: "2026-10-01" }))!.id;

    const film = await createFilm({ title: "A Clockwork Orange", releaseDate: year(1971), credits: [{ personId: kubrick, roleId: "film.director" }] });
    ids.film = film.id;
    await createFilmVersion({ workId: film.id, label: "Theatrical", runtimeSeconds: 8160 });
    await createWorkRelation({ type: "adaptation", fromWorkId: film.id, toWorkId: ids.book });

    const painting = await createPainting({ title: "Girl with a Pearl Earring", credits: [{ personId: vermeer, roleId: "painting.painter" }] });
    ids.painting = painting.id;
    const original = await createArtObject({ workId: painting.id, kind: "original", ownership: "institutional", ownerOrganizationId: mauritshuis, accessionNumber: "670" });
    ids.object = original.id;
    let history = await getWhereabouts(original.id);
    history = await recordWhereabouts(
      { objectId: original.id, placeKind: "venue", venueId: hague, custody: "permanent_collection", certainty: "confirmed", startsOn: year(1903), endsOn: year(2011) },
      history!.fingerprint,
    );
    history = await recordWhereabouts(
      { objectId: original.id, placeKind: "venue", venueId: tokyo, custody: "temporary_loan", certainty: "confirmed", startsOn: year(2012) },
      history.fingerprint,
    );

    // The collection holds the restored edition of the book, and the perfume and painting whole
    const shelf = await createCollection({ name: "Kept together" }, [ids.chosenEdition]);
    ids.collection = shelf.id;
    await bulkAddWorksToCollection(shelf.id, [perfume.id, painting.id]);
  }

  it("round-trips a mixed library without losing an edition choice or a location history", async () => {
    await library();
    const before = await tableCounts();
    const file = clone(await exportInterchange());
    expect(file.records.map((r) => r.domain).sort()).toEqual(["book", "film", "painting", "perfume"]);

    await wipe();
    const dry = await importInterchange(file, { policy: "keep", dryRun: true });
    expect(dry.counts).toEqual({ created: 4, unchanged: 0, added: 0, kept: 0, failed: 0 });
    expect(await value<number>(`select count(*)::int from works`)).toBe(0);
    expect(await value<number>(`select count(*)::int from authors`)).toBe(0);

    const run = await importInterchange(file, { policy: "keep", dryRun: false });
    expect(run.counts).toEqual({ created: 4, unchanged: 0, added: 0, kept: 0, failed: 0 });
    expect(run.records.find((r) => r.domain === "painting")!.written).toMatchObject({ art_object_whereabouts: 2, works: 1 });
    expect(await tableCounts()).toEqual(before);
    expect(strip(await exportInterchange())).toEqual(strip(file));

    // The collection keeps the chosen edition, not the first one, and its whole works
    expect(await c`select edition_id from collection_editions where collection_id = ${ids.collection}`).toEqual([{ edition_id: ids.chosenEdition }]);
    expect((await c`select work_id from collection_works where collection_id = ${ids.collection} order by sort_order`).map((r) => r.work_id)).toEqual([ids.perfume, ids.painting]);
    // The original keeps its whole history: home, then the loan, still current
    const history = await getWhereabouts(ids.object);
    expect(history!.records.map((h) => [h.venueName, h.custody]).sort()).toEqual([
      ["Mauritshuis, The Hague", "permanent_collection"],
      ["Tokyo Metropolitan Art Museum", "temporary_loan"],
    ]);
    expect(history!.current?.venueId).toBe(ids.tokyo);
  });

  it("writes nothing more when the same file comes again", async () => {
    await library();
    const file = clone(await exportInterchange());
    const before = await tableCounts();
    for (const policy of ["keep", "add", "fail"] as const) {
      const again = await importInterchange(file, { policy, dryRun: false });
      expect(again.counts).toEqual({ created: 0, unchanged: 4, added: 0, kept: 0, failed: 0 });
    }
    expect(await tableCounts()).toEqual(before);
  });

  it("fails one record alone, writes none of it, and a later run completes the rest", async () => {
    await library();
    const file = clone(await exportInterchange());
    await wipe();
    const broken = clone(file);
    // The loan's museum is neither here nor in the file
    broken.shared.venues = broken.shared.venues.filter((v) => v.id !== ids.tokyo);
    // A value the film's version cannot hold
    recordOf(broken, "film").sections.realizations!.film_versions[0].runtime_seconds = "long";
    // Two editions of the book with one ISBN: the database refuses the second
    const editions = recordOf(broken, "book").sections.realizations!.editions;
    editions[1].isbn_13 = editions[0].isbn_13;

    const report = await importInterchange(broken, { policy: "keep", dryRun: false });
    expect(outcomes(report)).toEqual({ book: "failed", film: "failed", painting: "failed", perfume: "created" });
    const problems = Object.fromEntries(report.records.map((r) => [r.domain, r.problems.join(" | ")]));
    expect(problems.book).toMatch(/Another record here already has one of these values \(editions_isbn_13_unique\)/);
    expect(problems.film).toMatch(/runtime_seconds: must be a whole number/);
    expect(problems.painting).toMatch(/It points at a venue that is neither here nor in the file/);
    // Nothing of a failed record was written
    expect(await c`select kind from works order by kind`).toEqual([{ kind: "perfume" }]);
    expect(await value<number>(`select count(*)::int from editions`)).toBe(0);
    expect(await value<number>(`select count(*)::int from art_objects`)).toBe(0);
    expect(await value<number>(`select count(*)::int from film_versions`)).toBe(0);

    const rest = await importInterchange(file, { policy: "keep", dryRun: false });
    expect(outcomes(rest)).toEqual({ book: "created", film: "created", painting: "created", perfume: "unchanged" });
    expect(await value<number>(`select count(*)::int from work_relations`)).toBe(1);
  });

  it("never changes curated edits here: keep, add and fail", async () => {
    await library();
    const file = clone(await exportInterchange());
    // Here: the person's own words and rating on the perfume, and the source locked
    const owner = { kind: "perfume" as const, id: ids.perfume };
    const curation = await getWorkCuration(owner);
    await updateWorkCuration({ owner, patch: { notes: "<p>My own words</p>", rating: 4.5 }, fingerprint: curation!.fingerprint });
    await c`update source_records set locked = true where id = ${ids.source}`;
    // In the file: a second bottle of the same formulation
    const holdings = recordOf(file, "perfume").sections.holdings!.perfume_bottles;
    holdings.push({ ...holdings[0], id: randomUUID(), capacity_value: 7.5 });

    const kept = await importInterchange(file, { policy: "keep", dryRun: false });
    const perfume = kept.records.find((r) => r.domain === "perfume")!;
    expect(perfume.outcome).toBe("kept");
    expect(perfume.absent).toEqual({ perfume_bottles: 1 });
    expect(perfume.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "works", columns: expect.arrayContaining(["notes", "rating"]) }),
        expect.objectContaining({ table: "source_records", columns: ["locked"] }),
      ]),
    );
    expect(await value<number>(`select count(*)::int from perfume_bottles`)).toBe(1);

    const failed = await importInterchange(file, { policy: "fail", dryRun: false });
    expect(failed.records.find((r) => r.domain === "perfume")).toMatchObject({ outcome: "failed", problems: ["It differs from the record here"] });

    const added = await importInterchange(file, { policy: "add", dryRun: false });
    expect(added.records.find((r) => r.domain === "perfume")).toMatchObject({ outcome: "added", written: { perfume_bottles: 1 } });
    expect(await value<number>(`select count(*)::int from perfume_bottles`)).toBe(2);
    expect(await c`select notes, rating::float as rating from works where id = ${ids.perfume}`).toEqual([{ notes: "<p>My own words</p>", rating: 4.5 }]);
    expect(await value<boolean>(`select locked from source_records where id = $1`, [ids.source])).toBe(true);
    // Everything else is as it was
    expect(outcomes(added)).toMatchObject({ book: "unchanged", film: "unchanged", painting: "unchanged" });
  });

  it("refuses an unknown version or format whole, and an unknown collection by name", async () => {
    await library();
    const file = clone(await exportInterchange());
    await expect(importInterchange({ ...file, version: 2 }, { policy: "keep", dryRun: true })).rejects.toThrow(
      "This file is interchange version 2; this Durtal reads version 1",
    );
    await expect(importInterchange({ ...file, format: "other" }, { policy: "keep", dryRun: true })).rejects.toThrow(InterchangeFileError);
    await expect(
      importInterchange({ ...file, shared: { ...file.shared, wines: [] } }, { policy: "keep", dryRun: true }),
    ).rejects.toThrow("The shared section has rows this Durtal cannot read");

    await wipe();
    const odd = clone(file);
    (odd.records[0] as { domain: string }).domain = "wine";
    const perfume = recordOf(odd, "perfume");
    perfume.sections.realizations = { ...perfume.sections.realizations, film_versions: [] };
    const report = await importInterchange(odd, { policy: "keep", dryRun: true });
    expect(report.records[0]).toMatchObject({ outcome: "failed", problems: [expect.stringContaining("“wine” is not a collection this Durtal knows")] });
    expect(report.records.find((r) => r.domain === "perfume")!.problems).toEqual([
      "sections.realizations.film_versions: a perfume record cannot carry it",
    ]);
    // A record cannot write into another one
    const smuggled = clone(file);
    recordOf(smuggled, "painting").sections.holdings = { perfume_bottles: [] };
    recordOf(smuggled, "book").sections.holdings!.instances[0].edition_id = randomUUID();
    const refused = await importInterchange(smuggled, { policy: "add", dryRun: true });
    expect(refused.records.find((r) => r.domain === "book")!.problems).toEqual(["sections.holdings.instances[0]: belongs to another record"]);
  });

  it("matches vocabularies by their natural keys, not by their ids", async () => {
    await library();
    const file = clone(await exportInterchange());
    await wipe();
    // Another Durtal numbers its seeded families and roles differently
    const family = file.shared.taxonomy_families.find((f) => f.slug === "perfume-notes")!;
    const elsewhere = JSON.parse(JSON.stringify(file).replaceAll(String(family.id), randomUUID())) as InterchangeDocument;
    const report = await importInterchange(elsewhere, { policy: "keep", dryRun: false });
    expect(report.counts.created).toBe(4);
    expect(
      await value(`select f.slug from perfume_notes n join custom_taxonomy_items i on i.id = n.item_id join taxonomy_families f on f.id = i.family_id`),
    ).toBe("perfume-notes");
    expect(await value<number>(`select count(*)::int from taxonomy_families where slug = 'perfume-notes'`)).toBe(1);

    // A family this Durtal does not have is named, and only its record fails
    await wipe();
    const missing = clone(file);
    missing.shared.taxonomy_families.find((f) => f.slug === "perfume-notes")!.slug = "perfume-moods";
    const partial = await importInterchange(missing, { policy: "keep", dryRun: true });
    expect(outcomes(partial)).toEqual({ book: "created", film: "created", painting: "created", perfume: "failed" });
    expect(partial.records.find((r) => r.domain === "perfume")!.problems).toContain("The taxonomy family “perfume-moods” does not exist here");
  });

  it("exports one collection or a few works", async () => {
    await library();
    const perfumes = await exportInterchange({ domains: ["perfume"] });
    expect(perfumes.records.map((r) => r.id)).toEqual([ids.perfume]);
    expect(Object.keys(perfumes.shared)).toEqual(expect.arrayContaining(["authors", "publishing_houses", "custom_taxonomy_items", "locations"]));
    expect(perfumes.shared.venues).toBeUndefined();
    const two = await exportInterchange({ ids: [ids.film, ids.book] });
    expect(two.records.map((r) => r.domain)).toEqual(["book", "film"]);
    // Only the film's own link: a link belongs to the work it starts from
    expect(recordOf(two, "film").sections.relations!.work_relations).toHaveLength(1);
    expect(recordOf(two, "book").sections.relations).toBeUndefined();
  });
});

describe.skipIf(!url)("provider observations", () => {
  const c = client!;
  const fake: ProviderAdapter<"perfume"> = {
    id: "example-notes",
    label: "Example notes",
    domain: "perfume",
    levels: ["work"],
    fields: { work: ["description", "title"] },
    documentation: "https://example.org/api",
    needsKey: false,
    limits: { timeoutMs: 1000, minIntervalMs: 0, maxResults: 5 },
    search: async () => [],
    detail: async (externalId) => ({
      externalId,
      url: "https://example.org/perfumes/1",
      attribution: "Example notes",
      license: "CC0",
      payload: { description: "Aldehydic floral" },
    }),
    normalize: (detail) => [{ level: "work", fields: { description: String(detail.payload.description), title: "Number Five" } }],
  };

  it("keeps a detail as a pending source, proposes only into empty fields and respects a lock", async () => {
    await c`truncate works, source_records, catalogue_identifiers cascade`;
    const perfume = await createPerfume({ title: "No 5" });
    const owner = { kind: "perfume" as const, id: perfume.id };
    const found = await fetchProviderDetail(fake, "no-5");
    const observation = await recordProviderDetail(fake, owner, found);
    expect(observation).toMatchObject({ provider: "example-notes", reviewStatus: "pending", locked: false });
    expect(await c`select provider, external_id from catalogue_identifiers`).toEqual([{ provider: "example-notes", external_id: "no-5" }]);
    // Nothing on the record changed
    expect(await c`select title, description from works`).toEqual([{ title: "No 5", description: null }]);

    const open = reviewProposal({ title: "No 5", description: null }, found.proposals[0], await providerLocks(owner, fake.id));
    expect(open.changes).toEqual({ description: "Aldehydic floral" });
    expect(open.conflicts).toEqual([{ field: "title", current: "No 5", incoming: "Number Five", reason: "different" }]);

    await c`update source_records set locked = true where id = ${observation.id}`;
    const locks = await providerLocks(owner, fake.id);
    expect(locks.record).toBe(true);
    const locked = reviewProposal({ title: "No 5", description: null }, found.proposals[0], locks);
    expect(locked.changes).toEqual({});
    expect(locked.conflicts.map((x) => [x.field, x.reason])).toEqual([
      ["description", "locked"],
      ["title", "locked"],
    ]);
    // A provider of one collection never describes another's records
    await expect(recordProviderDetail(fake, { kind: "film", id: perfume.id }, found)).rejects.toThrow("Example notes describes perfume records only");
  });
});
