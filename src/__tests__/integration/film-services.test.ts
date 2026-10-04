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

const url = process.env.DURTAL_FILM_SERVICES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln358_test")
    throw new Error("Film service tests require disposable local sln358_test");
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
  addFilmHolding,
  createFilm,
  createFilmVersion,
  deleteFilm,
  deleteFilmHolding,
  deleteFilmVersion,
  findFilmsByTitle,
  getFilm,
  getFilmChoices,
  getFilmCount,
  getFilmFilterOptions,
  getFilms,
  getFilmVersion,
  getRelatedFilms,
  updateFilm,
  updateFilmHolding,
  updateFilmVersion,
} from "@/lib/actions/films";
import { createPerson, getPersonMergePreview, mergePeople } from "@/lib/actions/people";
import {
  saveOrganization,
  getOrganizationMergePreview,
  mergeOrganizations,
} from "@/lib/actions/organizations";
import { updateWorkCuration, getWorkCuration } from "@/lib/actions/curation";
import { STALE_RECORD } from "@/lib/catalogue/work-store";
import { collectionExportRows } from "@/lib/export/collections";
import { classificationInput, otherClassificationIds } from "@/lib/catalogue/film-labels";
import type { CreateFilmInput, FilmQuery } from "@/lib/validations/films";

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

describe.skipIf(!url)("film catalogue, versions and optional copies", () => {
  const c = client!;
  let people: Record<string, string>;
  let orgs: Record<string, string>;
  let items: Record<string, string>;
  let place: Record<string, string>;
  let lang: Record<string, string>;
  let shelf: string, server: string;
  const day = (year: number, month: number, d: number) => ({
    precision: "day" as const,
    start: { year, month, day: d },
  });
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });
  const credit = (key: string, role: string, extra: object = {}) => ({
    personId: people[key],
    roleId: `film.${role}`,
    ...extra,
  });
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
    place = Object.fromEntries(
      (
        await c`insert into countries(name,alpha_2,alpha_3) values ('United States','US','USA'),('France','FR','FRA'),('Japan','JP','JPN') returning id,alpha_2`
      ).map((r) => [r.alpha_2, r.id]),
    );
    lang = Object.fromEntries(
      (
        await c`insert into languages(name,iso_639_1) values ('English','en'),('French','fr'),('Japanese','ja') returning id,iso_639_1`
      ).map((r) => [r.iso_639_1, r.id]),
    );
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await c`truncate works, authors, publishing_houses, venues, locations, custom_taxonomy_items, catalogue_dates, comments, activity_events, gallery_layouts, harmonization_operations, harmonization_redirects cascade`;
    people = {};
    for (const [key, name] of [
      ["carpenter", "John Carpenter"],
      ["lancaster", "Bill Lancaster"],
      ["russell", "Kurt Russell"],
      ["brimley", "Wilford Brimley"],
      ["nyby", "Christian Nyby"],
      ["melville", "Jean-Pierre Melville"],
      ["kurosawa", "Akira Kurosawa"],
    ])
      people[key] = (await createPerson({ name, domains: ["film"] })).id;
    orgs = {};
    for (const [key, name, roles] of [
      ["universal", "Universal Pictures", ["production_company", "distribution_company"]],
      ["rko", "RKO", ["production_company"]],
      ["shop", "Film Shop", ["retailer"]],
    ] as const)
      orgs[key] = (await saveOrganization({ name, roles: [...roles] }))!.id;
    const families = Object.fromEntries(
      (await c`select id,slug from taxonomy_families where slug in ('film-genres','perfume-families')`).map((r) => [r.slug, r.id]),
    );
    items = {};
    for (const [key, familySlug, parent] of [
      ["horror", "film-genres", null],
      ["bodyHorror", "film-genres", "horror"],
      ["crime", "film-genres", null],
      ["floral", "perfume-families", null],
    ] as const) {
      const [row] =
        await c`insert into custom_taxonomy_items(family_id,name,slug,parent_id) values (${families[familySlug]},${key},${key},${parent ? items[parent] : null}) returning id`;
      items[key] = row.id;
    }
    [shelf, server] = (
      await c`insert into locations(name,type) values ('Shelf','physical'),('Server','digital') returning id`
    ).map((r) => r.id);
  });

  const theThing = () =>
    createFilm({
      title: "The Thing",
      releaseDate: day(1982, 6, 25),
      countryIds: [place.US],
      languageIds: [lang.en],
      organizations: [{ organizationId: orgs.universal, role: "production_company" }],
      credits: [
        credit("carpenter", "director"),
        credit("lancaster", "screenwriter"),
        credit("russell", "cast", { characters: ["R.J. MacReady"] }),
        credit("brimley", "cast", { characters: ["Blair", "Blair-Thing"], creditedAs: "A. Wilford Brimley" }),
        { personId: null, roleId: "film.cast", attribution: "unknown" as const, characters: ["Norwegian"] },
        credit("carpenter", "composer"),
      ],
      classificationItemIds: [items.bodyHorror],
    });

  it("creates a film with ordered cast and crew, origins and genres in one transaction", async () => {
    const film = await theThing();
    expect(film.slug).toBe("the-thing-by-john-carpenter");
    expect(film.releaseDate?.value).toMatchObject({ precision: "day", start: { year: 1982, month: 6, day: 25 } });
    expect(film.countries.map((x) => x.alpha2)).toEqual(["US"]);
    expect(film.languages.map((x) => x.code)).toEqual(["en"]);
    expect(film.organizations).toEqual([expect.objectContaining({ name: "Universal Pictures", role: "production_company" })]);
    expect(film.credits.map((x) => [x.roleId, x.personId, x.characters, x.creditedAs])).toEqual([
      ["film.director", people.carpenter, [], null],
      ["film.screenwriter", people.lancaster, [], null],
      ["film.cast", people.russell, ["R.J. MacReady"], null],
      ["film.cast", people.brimley, ["Blair", "Blair-Thing"], "A. Wilford Brimley"],
      ["film.cast", null, ["Norwegian"], null],
      ["film.composer", people.carpenter, [], null],
    ]);
    expect(film.classification.map((x) => x.name)).toEqual(["bodyHorror"]);
    expect(film.versions).toEqual([]);
    expect(film.holdingsSummary).toMatchObject({ personallyOwned: false, activeCount: 0 });
    const [work] = await c`select kind,original_language from works where id=${film.id}`;
    expect(work).toEqual({ kind: "film", original_language: null });
    expect(await c`select 1 from person_domains where person_id=${people.carpenter} and kind='film'`).toHaveLength(1);
    expect(mocks.invalidate).toHaveBeenCalledWith("data:works", "ref:authors", "ref:custom-taxonomy-items");
  });

  it("keeps a remake with the same title as its own film", async () => {
    const remake = await theThing();
    const original = await createFilm({
      title: "The Thing",
      originalTitle: "The Thing from Another World",
      releaseDate: year(1951),
      organizations: [{ organizationId: orgs.rko, role: "production_company" }],
      credits: [credit("nyby", "director")],
    });
    expect(original.id).not.toBe(remake.id);
    expect(original.slug).not.toBe(remake.slug);
    expect(await getFilmCount({ search: "the thing" })).toBe(2);
    expect((await getFilms({ search: "another world" })).map((f) => f.id)).toEqual([original.id]);
  });

  it("rolls every section back when a late part fails", async () => {
    const base = { title: "Broken", releaseDate: year(2000), countryIds: [place.US], credits: [credit("carpenter", "director")] };
    expect(await failure(createFilm({ ...base, classificationItemIds: [items.floral] }))).toBe(
      "Taxonomy family does not apply to this domain and record level",
    );
    expect(await failure(createFilm({ ...base, credits: [{ personId: people.carpenter, roleId: "perfume.perfumer" }] }))).toBe(
      "Contribution role does not apply to films",
    );
    expect(
      await failure(
        createFilm({
          ...base,
          organizations: [{ organizationId: orgs.shop, role: "production_company" }],
          classificationItemIds: [items.floral],
        }),
      ),
    ).toBe("Taxonomy family does not apply to this domain and record level");
    // The company's new role was part of the rolled-back write
    expect(await c`select 1 from organization_roles where organization_id=${orgs.shop} and role='production_company'`).toHaveLength(0);
    for (const table of ["works", "film_details", "catalogue_dates", "film_countries", "work_credits"])
      expect(await c`select 1 from ${c(table)}`, table).toHaveLength(0);
  });

  it("replaces only supplied sections and keeps curation apart from copies", async () => {
    const film = await theThing();
    await updateWorkCuration({
      owner: { kind: "film", id: film.id },
      patch: { rating: 5, isFavourite: true, notes: "Watched in 2024" },
      fingerprint: (await getWorkCuration({ kind: "film", id: film.id }))!.fingerprint,
    });
    const curated = (await getFilm(film.id))!;
    expect(curated.fingerprint).toBe(film.fingerprint);
    expect(curated.holdingsSummary.personallyOwned).toBe(false);
    expect(await getFilmCount({ holding: "owned" })).toBe(0);
    const updated = await updateFilm(
      film.id,
      { originalTitle: "The Thing", countryIds: [place.US, place.FR], releaseDate: year(1982) },
      film.fingerprint,
    );
    expect(updated.countries.map((x) => x.alpha2)).toEqual(["US", "FR"]);
    expect(updated.credits.map((x) => x.id)).toEqual(film.credits.map((x) => x.id));
    expect(updated.curation).toEqual({ notes: "Watched in 2024", rating: 5, isFavourite: true });
    expect(await c`select id from catalogue_dates`).toHaveLength(1);
    expect(await failure(updateFilm(film.id, { title: "Lost" }, film.fingerprint))).toBe(STALE_RECORD);
    const results = await Promise.allSettled(
      ["A", "B", "C"].map((title) => updateFilm(film.id, { title }, updated.fingerprint)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("models cuts with unknown runtimes and releases in several territories", async () => {
    const film = await theThing();
    const theatrical = await createFilmVersion({
      workId: film.id,
      label: "Theatrical",
      runtimeSeconds: 109 * 60,
      releases: [
        { countryId: place.FR, format: "theatrical", releaseDate: day(1982, 11, 3) },
        { countryId: null, territoryLabel: "Festival circuit", format: "festival" },
        { countryId: place.US, format: "theatrical", releaseDate: day(1982, 6, 25), distributorId: orgs.universal },
      ],
    });
    expect(theatrical.releases.map((r) => [r.countryCode, r.format])).toEqual([
      ["US", "theatrical"],
      ["FR", "theatrical"],
      [null, "festival"],
    ]);
    const extended = await createFilmVersion({ workId: film.id, label: "Television" });
    expect(extended).toMatchObject({ runtimeSeconds: null, sortOrder: 1, releases: [] });
    expect(await failure(createFilmVersion({ workId: film.id, label: "Theatrical" }))).toBe(
      "This film already has a version with this label",
    );
    await createFilmVersion({ workId: film.id });
    expect(await failure(createFilmVersion({ workId: film.id }))).toBe("This film already has an unlabelled version");
    expect(
      await failure(
        updateFilmVersion(theatrical.id, { releases: [{ format: "theatrical", countryId: lang.en }] }, theatrical.fingerprint),
      ),
    ).toBe("Another record still uses this, or a linked record no longer exists");
    // The rejected edit changed nothing.
    expect((await getFilmVersion(theatrical.id))!.fingerprint).toBe(theatrical.fingerprint);

    const [us, fr] = theatrical.releases;
    const edited = await updateFilmVersion(
      theatrical.id,
      {
        runtimeSeconds: 108 * 60,
        releases: [
          { id: us.id, countryId: place.US, format: "theatrical", releaseDate: day(1982, 6, 25), distributorId: orgs.universal },
          { id: fr.id, countryId: place.FR, format: "theatrical", releaseDate: day(1982, 11, 10) },
          { countryId: place.JP, format: "theatrical", releaseDate: year(1982) },
        ],
      },
      theatrical.fingerprint,
    );
    expect(edited.runtimeSeconds).toBe(108 * 60);
    // Releases sort by date: the year-precision Japanese release starts on 1 January.
    expect(edited.releases.map((r) => r.countryCode)).toEqual(["JP", "US", "FR"]);
    const byId = new Map(edited.releases.map((r) => [r.id, r]));
    expect(byId.get(us.id)!.releaseDate!.id).toBe(us.releaseDate!.id);
    expect(byId.get(fr.id)!.releaseDate!.id).not.toBe(fr.releaseDate!.id);
    // film date, US, new FR, JP; the replaced FR date was released
    expect(await c`select id from catalogue_dates`).toHaveLength(4);
    expect(await failure(updateFilmVersion(theatrical.id, { notes: "late" }, theatrical.fingerprint))).toBe(STALE_RECORD);

    const current = (await getFilm(film.id))!;
    const reordered = current.versions.map((v) => v.id).reverse();
    const moved = await updateFilm(film.id, { versionOrder: reordered }, current.fingerprint);
    expect(moved.versions.map((v) => v.id)).toEqual(reordered);
    expect(await failure(updateFilm(film.id, { versionOrder: reordered.slice(1) }, moved.fingerprint))).toBe(
      "List every version of this film once",
    );
  });

  it("keeps copies optional, consistent with their film, and protective of it", async () => {
    const film = await theThing();
    const other = await createFilm({ title: "Le Samouraï" });
    const otherVersion = await createFilmVersion({ workId: other.id });
    const theatrical = await createFilmVersion({
      workId: film.id,
      label: "Theatrical",
      releases: [{ countryId: place.US, format: "home_media", releaseDate: year(2016), distributorId: orgs.universal }],
    });
    const tv = await createFilmVersion({ workId: film.id, label: "Television" });
    const release = theatrical.releases[0];
    const disc = await addFilmHolding({
      workId: film.id, versionId: theatrical.id, releaseId: release.id, medium: "physical", formatLabel: "Blu-ray",
      locationId: shelf, acquisitionDate: year(2017), supplierId: orgs.shop, acquisitionPrice: 25, acquisitionCurrency: "EUR",
    });
    expect(disc).toMatchObject({ medium: "physical", versionLabel: "Theatrical", locationName: "Shelf", status: "held" });
    expect(await failure(addFilmHolding({ workId: film.id, medium: "digital", locationId: shelf }))).toBe(
      "A physical copy needs a physical location and a digital copy a digital one",
    );
    expect(await failure(addFilmHolding({ workId: film.id, medium: "physical", versionId: otherVersion.id }))).toBe(
      "The version belongs to another film",
    );
    expect(await failure(addFilmHolding({ workId: film.id, medium: "physical", versionId: tv.id, releaseId: release.id }))).toBe(
      "The release belongs to another version",
    );
    expect(await failure(addFilmHolding({ workId: film.id, medium: "physical", acquisitionPrice: 10 }))).toBe(
      "Price and currency must be supplied together",
    );
    const file = await addFilmHolding({ workId: film.id, medium: "digital", formatLabel: "MKV", locationId: server });
    expect((await getFilm(film.id))!.holdingsSummary).toMatchObject({ activeCount: 2, physicalCount: 1, digitalCount: 1 });
    const gone = await updateFilmHolding(file.id, { status: "disposed", dispositionReason: "Deleted" }, file.fingerprint);
    expect(gone.status).toBe("disposed");
    expect((await getFilm(film.id))!.holdingsSummary).toMatchObject({ activeCount: 1, disposedCount: 1, digitalCount: 0 });

    expect(await failure(deleteFilmVersion(theatrical.id))).toBe("Delete or move the personal copies of this version first");
    expect(await failure(updateFilmVersion(theatrical.id, { releases: [] }, theatrical.fingerprint))).toBe(
      "A personal copy names a release you removed; change the copy first",
    );
    expect(await failure(deleteFilm(film.id))).toBe("Delete or move this film's personal copies first");
    await expect(
      saveOrganization({ name: "Universal Pictures", roles: ["production_company"] }, orgs.universal),
    ).rejects.toThrow(/^This organization role is in use by film records$/);
    await deleteFilmHolding(disc.id);
    await deleteFilmHolding(file.id);
    await deleteFilmVersion(tv.id);
    const poster = `gold/media/work/${film.id}/poster/a.webp`;
    await c`insert into media(work_id,type,s3_key) values (${film.id},'poster',${poster})`;
    await c`insert into comments(entity_type,entity_id,content_html) values ('work',${film.id},'<p>Note</p>')`;
    expect(await deleteFilm(film.id)).toEqual({ id: film.id, cleanupPending: false });
    expect(await getFilm(film.id)).toBeNull();
    expect(mocks.deleteUnusedObjects).toHaveBeenCalledWith({ keys: [poster], prefixes: ownedPrefixes.work(film.id) }, `film ${film.id}`);
    expect(await c`select 1 from film_versions where work_id=${film.id}`).toHaveLength(0);
    expect(await c`select 1 from film_releases where id=${release.id}`).toHaveLength(0);
    expect(await c`select 1 from film_countries where work_id=${film.id}`).toHaveLength(0);
    expect(await c`select 1 from media where work_id=${film.id}`).toHaveLength(0);
    expect(await c`select 1 from comments where entity_id=${film.id}`).toHaveLength(0);
    // Only the remaining film's values are left.
    expect(await c`select 1 from film_details`).toHaveLength(1);
    expect(await c`select id from catalogue_dates`).toHaveLength(0);
  });

  it("keeps companies, distributors and credits through organization and person merges", async () => {
    const film = await theThing();
    const duplicate = (await saveOrganization({
      name: "Universal Studios",
      roles: ["production_company", "distribution_company"],
    }))!;
    const version = await createFilmVersion({
      workId: film.id,
      label: "Theatrical",
      releases: [{ countryId: place.US, format: "theatrical", distributorId: duplicate.id }],
    });
    const twin = await createPerson({ name: "J. Carpenter", domains: ["film"] });
    const both = await updateFilm(
      film.id,
      {
        organizations: [
          { organizationId: duplicate.id, role: "production_company" },
          { organizationId: orgs.universal, role: "production_company" },
        ],
        credits: [...film.credits.map(({ id, personId, roleId, creditedAs, attribution, characters, notes }) => ({ id, personId, roleId, creditedAs, attribution, characters, notes })), { personId: twin.id, roleId: "film.editor" }],
      },
      film.fingerprint,
    );
    const conflicts = (fields: { key: string; conflict: boolean }[]) =>
      Object.fromEntries(fields.filter((f) => f.conflict).map((f) => [f.key, "target" as const]));
    const orgPreview = await getOrganizationMergePreview(duplicate.id, orgs.universal);
    await mergeOrganizations({ sourceId: duplicate.id, targetId: orgs.universal, fingerprint: orgPreview.fingerprint, choices: conflicts(orgPreview.fields) });
    const personPreview = await getPersonMergePreview(twin.id, people.carpenter);
    await mergePeople({ sourceId: twin.id, targetId: people.carpenter, fingerprint: personPreview.fingerprint, choices: conflicts(personPreview.fields) });
    const after = (await getFilm(film.id))!;
    expect(after.organizations.map((o) => o.organizationId)).toEqual([orgs.universal]);
    expect(after.versions.find((v) => v.id === version.id)!.releases[0].distributorId).toBe(orgs.universal);
    const editor = both.credits.find((x) => x.roleId === "film.editor")!;
    expect(after.credits.find((x) => x.id === editor.id)).toMatchObject({ personId: people.carpenter, roleId: "film.editor" });
  });

  it("rejects links across domains at the database boundary", async () => {
    const film = await createFilm({ title: "Crime film", classificationItemIds: [items.crime] });
    const [perfume] = await c`insert into works(title,kind,original_language) values ('Perfume','perfume',null) returning id`;
    await expect(c`insert into film_details(work_id) values (${perfume.id})`).rejects.toThrow("Film profiles require a film work");
    await expect(c`insert into custom_taxonomy_item_works(item_id,work_id) values (${items.horror},${perfume.id})`).rejects.toThrow();
    const version = await createFilmVersion({ workId: film.id });
    const other = await createFilm({ title: "Other" });
    await expect(c`update film_versions set work_id=${other.id} where id=${version.id}`).rejects.toThrow("cannot move to another film");
  });

  it("filters, sorts and pages with counts that always match the results", async () => {
    const make = async (
      title: string,
      input: Omit<CreateFilmInput, "title">,
      extra: { runtime?: number; copy?: "physical" | "digital"; favourite?: boolean } = {},
    ) => {
      const film = await createFilm({ ...input, title });
      if (extra.runtime) await createFilmVersion({ workId: film.id, runtimeSeconds: extra.runtime });
      if (extra.copy)
        await addFilmHolding({ workId: film.id, medium: extra.copy, locationId: extra.copy === "physical" ? shelf : server });
      if (extra.favourite) await c`update works set is_favourite=true where id=${film.id}`;
      return film.id;
    };
    await make("The Thing", { releaseDate: year(1982), countryIds: [place.US], languageIds: [lang.en], credits: [credit("carpenter", "director")], classificationItemIds: [items.bodyHorror] }, { runtime: 6540, copy: "physical" });
    await make("Halloween", { releaseDate: year(1978), countryIds: [place.US], credits: [credit("carpenter", "director"), credit("carpenter", "composer")], classificationItemIds: [items.horror] }, { runtime: 5460, favourite: true });
    await make("Le Samourai", { originalTitle: "Le Samouraï", releaseDate: { precision: "range", start: { year: 1967 }, end: { year: 1968 } }, countryIds: [place.FR], languageIds: [lang.fr], credits: [credit("melville", "director")], classificationItemIds: [items.crime] }, { runtime: 6300, copy: "digital" });
    await make("Rashomon", { releaseDate: year(1950), countryIds: [place.JP], languageIds: [lang.ja], credits: [credit("kurosawa", "director")] });
    await make("Undated", { credits: [credit("carpenter", "composer")] });
    await c`insert into works(title) values ('A book about films')`;
    const titles = async (q: FilmQuery) => (await getFilms({ ...q, limit: 200 })).map((f) => f.title);
    const cases: [FilmQuery, string[]][] = [
      [{}, ["Halloween", "Le Samourai", "Rashomon", "The Thing", "Undated"]],
      [{ personIds: [people.carpenter] }, ["Halloween", "The Thing", "Undated"]],
      [{ personIds: [people.carpenter], creditRoleIds: ["film.director"] }, ["Halloween", "The Thing"]],
      [{ taxonomyItemIds: [items.horror] }, ["Halloween", "The Thing"]],
      [{ taxonomyItemIds: [items.horror, items.bodyHorror] }, ["The Thing"]],
      [{ countryIds: [place.US, place.JP] }, ["Halloween", "Rashomon", "The Thing"]],
      [{ languageIds: [lang.fr] }, ["Le Samourai"]],
      [{ releaseYearFrom: 1968, releaseYearTo: 1979 }, ["Halloween", "Le Samourai"]],
      [{ holding: "owned" }, ["Le Samourai", "The Thing"]],
      [{ holding: "owned", media: ["digital"] }, ["Le Samourai"]],
      [{ holding: "not_owned" }, ["Halloween", "Rashomon", "Undated"]],
      [{ search: "samourai" }, ["Le Samourai"]],
      [{ favourite: true }, ["Halloween"]],
    ];
    for (const [q, expected] of cases) {
      expect(await titles(q), JSON.stringify(q)).toEqual(expected);
      expect(await getFilmCount(q), JSON.stringify(q)).toBe(expected.length);
    }
    expect((await titles({ sort: "release", order: "asc" })).slice(0, 4)).toEqual(["Rashomon", "Le Samourai", "Halloween", "The Thing"]);
    expect((await titles({ sort: "runtime" })).slice(0, 3)).toEqual(["The Thing", "Le Samourai", "Halloween"]);
    for (const sort of ["title", "release", "recent", "rating", "runtime"] as const) {
      const all = await titles({ sort });
      const paged: string[] = [];
      for (let offset = 0; offset < all.length; offset += 2)
        paged.push(...(await getFilms({ sort, limit: 2, offset })).map((f) => f.title));
      expect(paged, sort).toEqual(all);
    }
    const [card] = await getFilms({ search: "the thing" });
    expect(card).toMatchObject({
      title: "The Thing",
      runtimeSeconds: 6540,
      directors: [expect.objectContaining({ name: "John Carpenter" })],
      countries: [expect.objectContaining({ alpha2: "US" })],
      holdings: { physical: 1, digital: 0, personallyOwned: true },
    });
    await expect(getFilms({ creditRoleIds: ["film.director"] })).rejects.toThrow();
    await expect(getFilms({ holding: "not_owned", media: ["digital"] })).rejects.toThrow();
  });
  it("names a new film by its title and first director, numbered when taken", async () => {
    const first = await theThing();
    const second = await theThing();
    expect(first.slug).toBe("the-thing-by-john-carpenter");
    expect(second.slug).toBe("the-thing-by-john-carpenter-2");
    const credited = await createFilm({
      title: "Alan Smithee Film",
      credits: [{ personId: null, roleId: "film.director", creditedAs: "Alan Smithee" }],
    });
    expect(credited.slug).toBe("alan-smithee-film-by-alan-smithee");
    // Only a director names the film; a composer does not
    const undirected = await createFilm({ title: "Night Music", credits: [credit("carpenter", "composer")] });
    expect(undirected.slug).toBe("night-music");
    const renamed = await updateFilm(first.id, { title: "The Thing (1982)" }, first.fingerprint);
    expect(renamed.slug).toBe(first.slug);
    // /films/new is the Add film page: a film titled "New" never takes it
    expect((await createFilm({ title: "New" })).slug).toBe("new-2");
  });

  it("keeps the terms of other families when the edit form saves its genres", async () => {
    const [mood] =
      await c`insert into taxonomy_families(name,slug,entity_level) values ('Mood','mood','work')
        on conflict (slug) do update set name=excluded.name returning id`;
    await c`insert into taxonomy_applicability(family_id,kind,level) values (${mood.id},'film','work') on conflict do nothing`;
    const [bleak] =
      await c`insert into custom_taxonomy_items(family_id,name,slug) values (${mood.id},'Bleak','bleak') returning id`;
    const film = await createFilm({ title: "The Fog", classificationItemIds: [items.horror, bleak.id] });
    const names = (f: typeof film) => f.classification.map((x) => x.name).sort();
    expect(names(film)).toEqual(["Bleak", "horror"]);
    // What the form sends: its genres, then the other families' terms as they were
    const genreIds = (f: typeof film) =>
      f.classification.filter((x) => x.familySlug === "film-genres").map((x) => x.itemId);
    const saved = await updateFilm(
      film.id,
      { title: "The Fog (1980)", classificationItemIds: classificationInput(genreIds(film), otherClassificationIds(film.classification)) },
      film.fingerprint,
    );
    expect(names(saved)).toEqual(["Bleak", "horror"]);
    // Removing the last genre in the form still keeps the mood
    const cleared = await updateFilm(
      film.id,
      { classificationItemIds: classificationInput([], otherClassificationIds(saved.classification)) },
      saved.fingerprint,
    );
    expect(names(cleared)).toEqual(["Bleak"]);
  });

  it("gives each company, distributor and seller its role in the same write", async () => {
    const roles = async (id: string) =>
      (await c`select role from organization_roles where organization_id=${id} order by role`).map((r) => r.role);
    const film = await createFilm({
      title: "The Fog",
      organizations: [{ organizationId: orgs.shop, role: "production_company" }],
    });
    expect(film.organizations.map((o) => o.organizationId)).toEqual([orgs.shop]);
    expect(await roles(orgs.shop)).toEqual(["production_company", "retailer"]);
    const version = await createFilmVersion({
      workId: film.id,
      releases: [{ countryId: place.US, format: "theatrical", distributorId: orgs.rko }],
    });
    expect(version.releases[0]).toMatchObject({ distributorId: orgs.rko, distributorName: "RKO" });
    expect(await roles(orgs.rko)).toEqual(["distribution_company", "production_company"]);
    await addFilmHolding({ workId: film.id, medium: "physical", supplierId: orgs.universal });
    expect(await roles(orgs.universal)).toEqual(["distribution_company", "production_company", "retailer"]);
    // A role it already has stays as it is
    await updateFilmVersion(
      version.id,
      { releases: [{ id: version.releases[0].id, countryId: place.US, format: "theatrical", distributorId: orgs.rko }] },
      version.fingerprint,
    );
    expect(await roles(orgs.rko)).toEqual(["distribution_company", "production_company"]);
  });

  it("filters by director and cast together, each in its own role", async () => {
    const make = (title: string, credits: ReturnType<typeof credit>[]) => createFilm({ title, credits });
    await make("The Thing", [credit("carpenter", "director"), credit("russell", "cast")]);
    await make("Escape from New York", [credit("carpenter", "director"), credit("russell", "cast"), credit("carpenter", "composer")]);
    await make("Halloween", [credit("carpenter", "director")]);
    await make("Tango and Cash", [credit("nyby", "director"), credit("russell", "cast")]);
    await make("Silver Screen", [credit("russell", "director"), credit("carpenter", "cast")]);
    const titles = async (q: FilmQuery) => (await getFilms({ ...q, limit: 50 })).map((f) => f.title);
    const cases: [FilmQuery, string[]][] = [
      [{ directorIds: [people.carpenter] }, ["Escape from New York", "Halloween", "The Thing"]],
      [{ castIds: [people.russell] }, ["Escape from New York", "Tango and Cash", "The Thing"]],
      [{ directorIds: [people.carpenter], castIds: [people.russell] }, ["Escape from New York", "The Thing"]],
      [{ directorIds: [people.carpenter, people.nyby], castIds: [people.russell] }, ["Escape from New York", "Tango and Cash", "The Thing"]],
      [{ castIds: [people.carpenter] }, ["Silver Screen"]],
    ];
    for (const [q, expected] of cases) {
      expect(await titles(q), JSON.stringify(q)).toEqual(expected);
      expect(await getFilmCount(q), JSON.stringify(q)).toBe(expected.length);
    }
  });

  it("lists what the film home can filter by, with how many films each", async () => {
    expect(await getFilmFilterOptions()).toEqual({
      directors: [],
      cast: [],
      genres: [],
      languages: [],
      countries: [],
      releaseYears: null,
    });
    await theThing();
    await createFilm({
      title: "Le Samouraï",
      releaseDate: { precision: "range", start: { year: 1967 }, end: { year: 1968 } },
      countryIds: [place.FR],
      languageIds: [lang.fr],
      credits: [credit("melville", "director")],
      classificationItemIds: [items.crime],
    });
    await createFilm({ title: "Halloween", releaseDate: year(1978), countryIds: [place.US], credits: [credit("carpenter", "director")], classificationItemIds: [items.horror] });
    await c`insert into works(title) values ('A book about films')`;
    const options = await getFilmFilterOptions();
    // By surname
    expect(options.directors).toEqual([
      { id: people.carpenter, name: "John Carpenter", count: 2 },
      { id: people.melville, name: "Jean-Pierre Melville", count: 1 },
    ]);
    // By surname; a credit without a person record is not a choice
    expect(options.cast).toEqual([
      { id: people.brimley, name: "Wilford Brimley", count: 1 },
      { id: people.russell, name: "Kurt Russell", count: 1 },
    ]);
    // A narrower genre counts for the broader one too
    expect(options.genres).toEqual([
      { id: items.crime, name: "crime", parentName: null, count: 1 },
      { id: items.horror, name: "horror", parentName: null, count: 2 },
      { id: items.bodyHorror, name: "bodyHorror", parentName: "horror", count: 1 },
    ]);
    expect(options.languages).toEqual([
      { id: lang.en, name: "English", count: 1 },
      { id: lang.fr, name: "French", count: 1 },
    ]);
    expect(options.countries).toEqual([
      { id: place.FR, name: "France", count: 1 },
      { id: place.US, name: "United States", count: 2 },
    ]);
    expect(options.releaseYears).toEqual({ min: 1967, max: 1982 });
  });

  it("finds related films by director, shared cast and shared genres, each film once", async () => {
    const thing = await createFilm({
      title: "The Thing",
      releaseDate: year(1982),
      credits: [credit("carpenter", "director"), credit("russell", "cast"), credit("brimley", "cast")],
      classificationItemIds: [items.horror, items.crime],
    });
    const make = (title: string, input: Omit<CreateFilmInput, "title"> = {}) => createFilm({ ...input, title });
    const escape = await make("Escape from New York", { releaseDate: year(1981), credits: [credit("carpenter", "director"), credit("russell", "cast")] });
    const halloween = await make("Halloween", { releaseDate: year(1978), credits: [credit("carpenter", "director")] });
    const cocoon = await make("Cocoon", { credits: [credit("brimley", "cast"), credit("russell", "cast")] });
    const hardcore = await make("Hardcore", { credits: [credit("brimley", "cast")], classificationItemIds: [items.horror, items.crime] });
    await make("One Genre", { classificationItemIds: [items.horror] });
    await make("No Link", { credits: [credit("kurosawa", "director")] });
    const related = await getRelatedFilms(thing.id);
    expect(related.director).toMatchObject({ id: people.carpenter, name: "John Carpenter" });
    // Oldest first; Escape from New York appears only under the director
    expect(related.director!.films.map((f) => f.id)).toEqual([halloween.id, escape.id]);
    expect(related.cast.map((f) => [f.id, f.shared])).toEqual([
      [cocoon.id, ["Kurt Russell", "Wilford Brimley"]],
      [hardcore.id, ["Wilford Brimley"]],
    ]);
    // Hardcore already shows under the cast, so no film shares two genres
    expect(related.genres).toEqual([]);
    const lonely = await make("Lonely", { classificationItemIds: [items.horror, items.crime] });
    expect((await getRelatedFilms(lonely.id)).genres.map((f) => [f.id, f.shared])).toEqual([
      [thing.id, ["crime", "horror"]],
      [hardcore.id, ["crime", "horror"]],
    ].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)));
    expect(await getRelatedFilms(halloween.id)).toMatchObject({ cast: [], genres: [] });
  });

  it("finds films with the same title or original title, and the choices of the form", async () => {
    const thing = await theThing();
    const samourai = await createFilm({ title: "The Samurai", originalTitle: "Le Samouraï" });
    expect((await findFilmsByTitle("the THING")).map((f) => f.id)).toEqual([thing.id]);
    expect((await findFilmsByTitle("le samourai")).map((f) => f.id)).toEqual([samourai.id]);
    expect(await findFilmsByTitle("The Thing from Another World")).toEqual([]);
    const choices = await getFilmChoices();
    expect(choices.countries.map((x) => x.name)).toEqual(["France", "Japan", "United States"]);
    expect(choices.languages.map((x) => x.name)).toEqual(["English", "French", "Japanese"]);
  });

  it("exports films one row each, and leaves other kinds out", async () => {
    const film = await theThing();
    await c`insert into works(title) values ('The Thing')`;
    const [row, ...more] = await collectionExportRows("films", null);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({
      title: "The Thing",
      directors: "John Carpenter",
      released: expect.stringContaining("1982"),
      countries: "United States",
      genres: "bodyHorror",
      physical_copies: 0,
      favourite: "no",
    });
    expect(row.cast).toContain("A. Wilford Brimley");
    // Ids of another kind export nothing
    expect(await collectionExportRows("paintings", [film.id])).toEqual([]);
  });
});
