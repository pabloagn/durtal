import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import { CROSSING, ENTITIES, SOLARIS, SOLARIS_REMAKE, stubState, wikidataFetch, type StubState } from "@/__tests__/fixtures/films/wikidata";

const url = process.env.DURTAL_FILM_SOURCES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln376_film_sources")
    throw new Error("Film source tests require disposable local sln376_film_sources");
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
// Wikidata is stubbed here: no pause between calls (the 1 s gap is pinned in catalogue/film-sources.test.ts)
vi.mock("@/lib/providers/wikidata-films", async (original) => {
  const actual = await original<typeof import("@/lib/providers/wikidata-films")>();
  return { ...actual, wikidataFilms: { ...actual.wikidataFilms, limits: { ...actual.wikidataFilms.limits, minIntervalMs: 0 } } };
});
import { applyFilmSource, reviewFilmSource, searchFilmSource } from "@/lib/actions/film-sources";
import { createFilm, createFilmVersion, getFilm } from "@/lib/actions/films";
import { createPerson } from "@/lib/actions/people";

/*
 * SLN-376: reviewed film lookup on PostgreSQL, with Wikidata and Commons
 * answered by the fixture. Nothing else is called.
 */
describe.skipIf(!url)("film source lookup", () => {
  const c = client!;
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });
  let state: StubState;
  let france: string;
  let russian: string;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, catalogue_dates, source_records, catalogue_identifiers, activity_events, countries, languages cascade`;
    state = stubState();
    vi.stubGlobal("fetch", wikidataFetch(state));
    [{ id: france }] = await c`insert into countries(name, alpha_2, alpha_3) values ('France', 'FR', 'FRA') returning id`;
    [{ id: russian }] = await c`insert into languages(name, iso_639_1) values ('Russian', 'ru') returning id`;
  });

  it("finds films of a title, and reviews one against the film here without writing", async () => {
    expect(await searchFilmSource("Solaris")).toMatchObject({
      hits: [
        { externalId: SOLARIS, detail: "1972 · directed by Andrei Tarkovsky" },
        { externalId: SOLARIS_REMAKE, detail: "2002 · directed by Steven Soderbergh" },
      ],
    });
    const tarkovsky = await createPerson({ name: "Andrei Tarkovsky", domains: ["film"] });
    const film = await createFilm({ title: "Solaris", credits: [{ personId: tarkovsky.id, roleId: "film.director" }] });
    const review = await reviewFilmSource({ filmId: film.id, externalId: SOLARIS });
    expect(review).toMatchObject({
      locked: false,
      heldBy: null,
      year: { here: null, source: 1972, differs: false },
      fields: [
        { field: "title", here: "Solaris", verdict: "same" },
        { field: "originalTitle", here: null, source: "Солярис", verdict: "fill" },
        { field: "description", verdict: "fill" },
        { field: "releaseDate", source: "Mar 20, 1972", verdict: "fill" },
        // Not in Durtal's country list: shown, never created
        { field: "countries", source: "Soviet Union", verdict: "unlisted", unmatched: ["Soviet Union"] },
        { field: "languages", source: "Russian", verdict: "fill", unmatched: [] },
      ],
      unnamedCredits: 1,
      version: { id: null },
      runtime: { seconds: 10020, here: null, verdict: "fill" },
      identifiers: [
        { provider: "imdb", externalId: "tt0069293", url: "https://www.imdb.com/title/tt0069293/", here: false, heldBy: null },
        { provider: "tmdb", externalId: "593" },
        { provider: "letterboxd", externalId: "solaris" },
      ],
      releases: [
        { index: 0, place: "Cannes Film Festival", country: null, format: "festival" },
        { index: 1, place: "Soviet Union", country: null, format: "theatrical" },
        { index: 2, place: "France", country: { id: france }, format: "theatrical" },
      ],
      image: { kind: "poster", credit: "Mikhail Romadin & studio", license: "Public domain", here: false },
      previous: null,
    });
    const credits = (review as { credits: { name: string; role: string; match: unknown; here: boolean }[] }).credits;
    expect(credits.map((x) => [x.role, x.name, !!x.match, x.here])).toEqual([
      ["Director", "Andrei Tarkovsky", true, true],
      ["Screenwriter", "Andrei Tarkovsky", true, false],
      ["Screenwriter", "Fridrikh Gorenshtein", false, false],
      ["Cast", "Donatas Banionis", false, false],
      ["Cast", "Natalya Bondarchuk", false, false],
      ["Composer", "Eduard Artemyev", false, false],
    ]);
    // Reading is not writing
    expect(await c`select count(*)::int as n from source_records`).toEqual([{ n: 0 }]);
    expect(await c`select count(*)::int as n from catalogue_identifiers`).toEqual([{ n: 0 }]);
  });

  it("adds what the person chose after the film's own credits, keeps an incomplete cast's others, and adds nothing twice", async () => {
    const extra = await createPerson({ name: "Jüri Järvet", domains: ["film"] });
    const film = await createFilm({ title: "Solaris", credits: [{ personId: extra.id, roleId: "film.cast", characters: ["Snaut"] }] });
    const saved = await applyFilmSource({
      filmId: film.id,
      fingerprint: film.fingerprint,
      externalId: SOLARIS,
      fields: ["originalTitle", "releaseDate", "languages", "countries"],
      credits: ["film.director:Q900301", "film.screenwriter:Q900301", "film.cast:Q900304", "film.cast:Q900303"],
      organizations: ["Q900501"],
      identifiers: ["imdb", "tmdb"],
      runtime: true,
      releases: [0, 2],
    });
    // Countries: the only one is not in Durtal's list, so nothing is filled
    expect(saved).toMatchObject({ added: ["Original title", "First release", "Original languages", "Mosfilm", "4 credits", "IMDb id", "TMDB id", "Running time", "2 releases"] });
    const sourceId = (saved as { sourceRecordId: string }).sourceRecordId;
    const after = (await getFilm(film.id))!;
    expect([after.title, after.originalTitle, after.description]).toEqual(["Solaris", "Солярис", null]);
    expect(after.releaseDate?.value).toMatchObject({ precision: "day", start: { year: 1972, month: 3, day: 20 } });
    expect(after.sourceRecordId).toBe(sourceId);
    expect(after.languages.map((l) => l.id)).toEqual([russian]);
    expect(after.countries).toEqual([]);
    expect(after.organizations.map((o) => [o.name, o.role, o.sourceRecordId])).toEqual([["Mosfilm", "production_company", sourceId]]);
    // The credit here stays first; Tarkovsky is one person in two roles; the cast in billing order with characters
    expect(after.credits.map((x) => [x.roleId, x.person?.name, x.characters, x.attribution])).toEqual([
      ["film.cast", "Jüri Järvet", ["Snaut"], "unspecified"],
      ["film.director", "Andrei Tarkovsky", [], "attributed"],
      ["film.screenwriter", "Andrei Tarkovsky", [], "attributed"],
      ["film.cast", "Donatas Banionis", ["Kris Kelvin"], "attributed"],
      ["film.cast", "Natalya Bondarchuk", ["Hari"], "attributed"],
    ]);
    expect(await c`select count(*)::int as n from authors where name = 'Andrei Tarkovsky'`).toEqual([{ n: 1 }]);
    // A new version with the running time and the chosen releases, each citing the source
    expect(after.versions).toHaveLength(1);
    expect(after.versions[0]).toMatchObject({ runtimeSeconds: 10020, sourceRecordId: sourceId });
    expect(after.versions[0].releases.map((r) => [r.territoryLabel, r.countryId, r.format, r.releaseDate?.value.start?.year, r.sourceRecordId])).toEqual([
      ["Cannes Film Festival", null, "festival", 1972, sourceId],
      [null, france, "theatrical", 1973, sourceId],
    ]);
    expect((await c`select provider, entity_kind, external_id from catalogue_identifiers order by provider, entity_kind, external_id`).map((r) => `${r.provider}:${r.entity_kind}:${r.external_id}`)).toEqual([
      "imdb:film:tt0069293",
      "tmdb:film:593",
      "wikidata:film:Q900101",
      "wikidata:organization:Q900501",
      "wikidata:person:Q900301",
      "wikidata:person:Q900303",
      "wikidata:person:Q900304",
    ]);
    expect(await c`select provider, review_status, locked from source_records`).toEqual([{ provider: "wikidata", review_status: "accepted", locked: false }]);

    // Again, everything chosen: it is all here, and the other release joins the same version
    const current = (await getFilm(film.id))!;
    const second = await applyFilmSource({
      filmId: film.id,
      fingerprint: current.fingerprint,
      externalId: SOLARIS,
      fields: ["originalTitle", "releaseDate", "languages"],
      credits: ["film.director:Q900301", "film.cast:Q900304"],
      organizations: ["Q900501"],
      identifiers: ["imdb"],
      runtime: true,
      releases: [0, 1, 2],
    });
    expect(second).toMatchObject({ added: ["1 release"] });
    const last = (await getFilm(film.id))!;
    expect(last.credits).toHaveLength(5);
    expect(last.versions[0].releases.map((r) => r.territoryLabel ?? "France")).toEqual(["Soviet Union", "Cannes Film Festival", "France"]);
  });

  it("matches countries and languages by ISO code where their English names differ from Durtal's lists (SLN-551)", async () => {
    // Durtal's lists carry ISO names; Wikidata says "United States", "France", "Spanish" and "Cantonese"
    await c`update countries set name = 'France, French Republic' where id = ${france}`;
    const [{ id: us }] = await c`insert into countries(name, alpha_2, alpha_3) values ('United States of America', 'US', 'USA') returning id`;
    // A former country: Wikidata gives it no code, so its English name still matches
    const [{ id: soviet }] = await c`insert into countries(name, alpha_2, alpha_3) values ('Soviet Union', 'SU', 'SUN') returning id`;
    const [{ id: spanish }] = await c`insert into languages(name, iso_639_1, iso_639_3) values ('Spanish; Castilian', 'es', 'spa') returning id`;
    // No ISO 639-1 code: matched by its 639-3 code
    const [{ id: yue }] = await c`insert into languages(name, iso_639_3) values ('Yue Chinese', 'yue') returning id`;
    // A name alone does not override a code: "Cantonese" here is not the language Wikidata's code names
    await c`insert into languages(name, iso_639_3) values ('Cantonese', 'xxx')`;
    const film = await createFilm({ title: "Crossing" });

    const review = (await reviewFilmSource({ filmId: film.id, externalId: CROSSING })) as { fields: { field: string }[]; releases: unknown[] };
    expect(review.fields.filter((f) => f.field === "countries" || f.field === "languages")).toEqual([
      { field: "countries", label: "Countries", here: null, source: "United States, France", verdict: "fill", unmatched: [] },
      { field: "languages", label: "Original languages", here: null, source: "Spanish, Cantonese", verdict: "fill", unmatched: [] },
    ]);
    expect(review.releases).toMatchObject([
      { index: 0, place: "Venice Film Festival", country: null, format: "festival" },
      { index: 1, place: "United States", country: { id: us, name: "United States of America" }, format: "theatrical" },
      { index: 2, place: "Soviet Union", country: { id: soviet, name: "Soviet Union" }, format: "theatrical" },
    ]);

    const saved = await applyFilmSource({
      filmId: film.id,
      fingerprint: film.fingerprint,
      externalId: CROSSING,
      fields: ["countries", "languages"],
      credits: [],
      organizations: [],
      identifiers: [],
      runtime: false,
      releases: [0, 1, 2],
    });
    expect(saved).toMatchObject({ added: ["Countries", "Original languages", "3 releases"] });
    const after = (await getFilm(film.id))!;
    expect(after.countries.map((x) => x.id)).toEqual([us, france]);
    expect(after.languages.map((x) => x.id)).toEqual([spanish, yue]);
    expect(after.versions[0].releases.map((r) => [r.territoryLabel, r.countryId])).toEqual([
      ["Venice Film Festival", null],
      [null, us],
      [null, soviet],
    ]);
  });

  it("tells a remake from the film it remakes: a different year waits for the person, and one Wikidata film is one film here", async () => {
    const remake = await createFilm({ title: "Solaris", releaseDate: year(2002) });
    const review = await reviewFilmSource({ filmId: remake.id, externalId: SOLARIS });
    expect(review).toMatchObject({ year: { here: 2002, source: 1972, differs: true } });
    expect(await applyFilmSource({ filmId: remake.id, fingerprint: remake.fingerprint, externalId: SOLARIS, credits: ["film.director:Q900301"] })).toEqual({
      error: "Wikidata's film is from 1972, this one from 2002. A remake is a separate film: confirm it is the same film to save.",
    });
    expect((await getFilm(remake.id))!.credits).toEqual([]);
    expect(await c`select count(*)::int as n from source_records`).toEqual([{ n: 0 }]);
    // The right film for it
    expect(await applyFilmSource({ filmId: remake.id, fingerprint: remake.fingerprint, externalId: SOLARIS_REMAKE, credits: ["film.director:Q900310"] })).toMatchObject({
      added: ["1 credit"],
    });

    // The 1972 film entered twice: the second cannot take the Wikidata film the first has
    const original = await createFilm({ title: "Solaris", releaseDate: year(1972) });
    const twin = await createFilm({ title: "Solaris" });
    await applyFilmSource({ filmId: original.id, fingerprint: original.fingerprint, externalId: SOLARIS, identifiers: ["imdb"] });
    const held = await reviewFilmSource({ filmId: twin.id, externalId: SOLARIS });
    expect(held).toMatchObject({ heldBy: { title: "Solaris" }, identifiers: [{ provider: "imdb", heldBy: "Solaris", here: false }, { provider: "tmdb" }, { provider: "letterboxd" }] });
    expect(await applyFilmSource({ filmId: twin.id, fingerprint: twin.fingerprint, externalId: SOLARIS })).toEqual({
      error: "This Wikidata film is already Solaris here. A remake is a separate film.",
    });
    // Confirmed as the same film despite its year: the person's word
    const misdated = await createFilm({ title: "Crowd", releaseDate: year(1995) });
    expect(await applyFilmSource({ filmId: misdated.id, fingerprint: misdated.fingerprint, externalId: "Q900104", sameFilm: true })).toMatchObject({ added: [] });
  });

  it("keeps different values and a locked source, and shows what changed on Wikidata since the last save", async () => {
    const film = await createFilm({ title: "Solaris", originalTitle: "Solyaris", releaseDate: year(1972), languageIds: [russian] });
    const version = await createFilmVersion({ workId: film.id, label: "Theatrical", runtimeSeconds: 9900 });
    const review = await reviewFilmSource({ filmId: film.id, externalId: SOLARIS });
    expect(review).toMatchObject({
      fields: [
        { field: "title", verdict: "same" },
        { field: "originalTitle", here: "Solyaris", verdict: "conflict" },
        { field: "description", verdict: "fill" },
        { field: "releaseDate", here: "1972", verdict: "conflict" },
        { field: "countries", verdict: "unlisted" },
        { field: "languages", verdict: "same" },
      ],
      version: { id: version.id, label: "Theatrical" },
      runtime: { here: 9900, verdict: "conflict" },
    });
    const saved = await applyFilmSource({ filmId: film.id, fingerprint: film.fingerprint, externalId: SOLARIS, fields: ["originalTitle", "releaseDate"], runtime: true, releases: [2] });
    expect(saved).toMatchObject({ added: ["1 release"] });
    const after = (await getFilm(film.id))!;
    expect([after.originalTitle, after.releaseDate?.value.precision, after.versions[0].runtimeSeconds]).toEqual(["Solyaris", "year", 9900]);
    expect(after.versions[0].releases).toHaveLength(1);

    // Wikidata changes: the review says what changed, and the film keeps its values
    state.overrides = {
      [SOLARIS]: {
        ...ENTITIES[SOLARIS],
        claims: { ...(ENTITIES[SOLARIS].claims as object), P2047: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { amount: "+169", unit: "http://www.wikidata.org/entity/Q7727" } } } }] },
      },
    };
    const refreshed = await reviewFilmSource({ filmId: film.id, externalId: SOLARIS });
    expect(refreshed).toMatchObject({ previous: { changes: ["Running time: 2h 47m → 2h 49m"] }, runtime: { seconds: 10140, here: 9900, verdict: "conflict" } });

    // Locked: nothing changes, whatever is chosen
    await c`update source_records set locked = true`;
    const locked = await reviewFilmSource({ filmId: film.id, externalId: SOLARIS });
    expect(locked).toMatchObject({ locked: true, runtime: { verdict: "locked" } });
    const current = (await getFilm(film.id))!;
    expect(await applyFilmSource({ filmId: film.id, fingerprint: current.fingerprint, externalId: SOLARIS, credits: ["film.cast:Q900304"] })).toEqual({
      error: "A locked Wikidata source keeps this film as it is",
    });
    expect((await getFilm(film.id))!.credits).toEqual([]);
  });

  it("works without Wikidata: every action answers with a message, and a film is entered by hand", async () => {
    state.offline = true;
    expect(await searchFilmSource("Solaris")).toEqual({ error: "Wikidata could not be reached" });
    const film = await createFilm({ title: "Solaris", releaseDate: year(1972) });
    expect(await reviewFilmSource({ filmId: film.id, externalId: SOLARIS })).toEqual({ error: "Wikidata could not be reached" });
    expect(await applyFilmSource({ filmId: film.id, fingerprint: film.fingerprint, externalId: SOLARIS, credits: ["film.director:Q900301"] })).toEqual({
      error: "Wikidata could not be reached",
    });
    state.offline = false;
    state.status = 429;
    expect(await searchFilmSource("Solaris")).toEqual({ error: "Wikidata asks to wait before the next call" });
    expect(await reviewFilmSource({ filmId: film.id, externalId: "tt0069293" })).toEqual({ error: "A Wikidata id looks like Q193570" });
    expect((await getFilm(film.id))!.title).toBe("Solaris");
    // Only Wikidata was ever asked
    expect(new Set(state.calls.map((u) => u.host))).toEqual(new Set(["www.wikidata.org"]));
  });
});
