import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILM_SOURCES, filmSourceChanges, releaseFormat, type FilmProposals } from "@/lib/catalogue/film-sources";
import { adapterProblems, ProviderError, type ProviderAdapter } from "@/lib/providers/contract";
import { providersFor } from "@/lib/providers/registry";
import { fetchProviderDetail, searchProvider } from "@/lib/providers/run";
import { earliestDate, wikidataFilms } from "@/lib/providers/wikidata-films";
import { CROWD, SOLARIS, SOLARIS_REMAKE, stubState, wikidataFetch, type StubState } from "@/__tests__/fixtures/films/wikidata";

// No pause between stubbed calls; the 1 s Wikidata's terms ask for is pinned below
const films = { ...wikidataFilms, limits: { ...wikidataFilms.limits, minIntervalMs: 0 } };

describe("film sources", () => {
  let state: StubState;
  beforeEach(() => {
    state = stubState();
    vi.stubGlobal("fetch", wikidataFetch(state));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("looks up only a source with a documented API and no key; the others are cited", () => {
    expect(FILM_SOURCES.filter((s) => s.access === "lookup").map((s) => s.name)).toEqual(["Wikidata"]);
    expect(FILM_SOURCES.filter((s) => s.access === "cite").map((s) => s.name)).toEqual(["TMDB", "IMDb", "Letterboxd"]);
    // TMDB's terms: a key, non-commercial use, and its notice
    expect(FILM_SOURCES.find((s) => s.name === "TMDB")!.why).toContain("This product uses the TMDB API but is not endorsed or certified by TMDB");
    expect(providersFor("film").map((p) => p.id)).toEqual(["wikidata"]);
    // One Wikidata id for a person, whichever collection named them
    expect(providersFor("perfume").map((p) => p.id)).toEqual(["wikidata"]);
    expect(adapterProblems(wikidataFilms as unknown as ProviderAdapter)).toEqual([]);
    expect(wikidataFilms.needsKey).toBe(false);
    expect(wikidataFilms.limits.minIntervalMs).toBe(1000);
  });

  it("finds films only, with the year and director that tell a remake apart", async () => {
    const hits = await searchProvider(films, { text: "Solaris", level: "work" });
    expect(hits).toEqual([
      { externalId: SOLARIS, title: "Solaris", detail: "1972 · directed by Andrei Tarkovsky", url: `https://www.wikidata.org/wiki/${SOLARIS}` },
      { externalId: SOLARIS_REMAKE, title: "Solaris", detail: "2002 · directed by Steven Soderbergh", url: `https://www.wikidata.org/wiki/${SOLARIS_REMAKE}` },
    ]);
  });

  it("finds a film by its IMDb or TMDB id or link, or its Wikidata id, without a title search", async () => {
    for (const text of ["https://www.imdb.com/title/tt0069293/", "tt0069293", "https://www.themoviedb.org/movie/593-solaris", SOLARIS, `https://www.wikidata.org/wiki/${SOLARIS}`]) {
      state.calls = [];
      expect((await searchProvider(films, { text, level: "work" })).map((h) => h.externalId), text).toEqual([SOLARIS]);
      expect(state.calls.some((u) => u.searchParams.get("action") === "wbsearchentities"), text).toBe(false);
    }
    expect(state.calls.length).toBeGreaterThan(0);
  });

  it("reads a film's detail: titles, releases, credits in billing order with characters, ids and the poster's credit", async () => {
    const { detail, proposals } = await fetchProviderDetail(films, SOLARIS);
    expect(detail).toMatchObject({ externalId: SOLARIS, attribution: "Wikidata", license: "CC0 1.0" });
    const work = proposals.find((p) => p.level === "work")!.fields;
    expect(work).toMatchObject({
      title: "Solaris",
      originalTitle: "Солярис",
      description: "1972 film by Andrei Tarkovsky",
      // The earliest date, not the preferred one
      releaseDate: { precision: "day", start: { year: 1972, month: 3, day: 20 } },
      countries: [{ wikidataId: "Q900202", name: "Soviet Union" }],
      languages: [{ wikidataId: "Q900203", name: "Russian" }],
      organizations: [{ wikidataId: "Q900501", name: "Mosfilm", role: "production_company" }],
      identifiers: { imdb: "tt0069293", tmdb: "593", letterboxd: "solaris" },
      image: {
        file: "Solaris 1972 poster.jpg",
        kind: "poster",
        url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Solaris_1972_poster.jpg",
        page: "https://commons.wikimedia.org/wiki/File:Solaris_1972_poster.jpg",
        credit: "Mikhail Romadin & studio",
        license: "Public domain",
        licenseUrl: null,
      },
    });
    expect((work.credits as { name: string; roleId: string; characters: string[] }[]).map((c) => [c.roleId, c.name, c.characters])).toEqual([
      ["film.director", "Andrei Tarkovsky", []],
      ["film.screenwriter", "Andrei Tarkovsky", []],
      ["film.screenwriter", "Fridrikh Gorenshtein", []],
      // Billing order from the ordinals; a deprecated credit and a person without an English name are left out
      ["film.cast", "Donatas Banionis", ["Kris Kelvin"]],
      ["film.cast", "Natalya Bondarchuk", ["Hari"]],
      ["film.composer", "Eduard Artemyev", []],
    ]);
    expect((detail.payload as { unnamedCredits: number }).unnamedCredits).toBe(1);
    expect(proposals.filter((p) => p.level === "version")).toEqual([{ level: "version", fields: { runtimeSeconds: 167 * 60 } }]);
    expect(proposals.filter((p) => p.level === "release").map((p) => p.fields)).toEqual([
      { releaseDate: { precision: "day", start: { year: 1972, month: 5, day: 13 } }, place: { wikidataId: "Q900201", name: "Cannes Film Festival" } },
      { releaseDate: { precision: "day", start: { year: 1972, month: 3, day: 20 } }, place: { wikidataId: "Q900202", name: "Soviet Union" } },
      { releaseDate: { precision: "day", start: { year: 1973, month: 5, day: 10 } }, place: { wikidataId: "Q900204", name: "France" } },
    ]);
  });

  it("names a large cast in pages of 50, and keeps a film without a poster", async () => {
    const { proposals } = await fetchProviderDetail(films, CROWD);
    const credits = proposals.find((p) => p.level === "work")!.fields.credits as { name: string }[];
    expect(credits).toHaveLength(60);
    expect(credits.at(-1)!.name).toBe("Crowd Actor 60");
    const labelCalls = state.calls.filter((u) => u.searchParams.get("props") === "labels");
    expect(labelCalls.map((u) => u.searchParams.get("ids")!.split("|").length)).toEqual([50, 10]);
    expect(state.calls.some((u) => u.host === "commons.wikimedia.org")).toBe(false);
  });

  it("refuses an item that is not a film, and says why a call failed", async () => {
    await expect(fetchProviderDetail(films, "Q900103")).rejects.toThrow("Solaris is not a film on Wikidata");
    await expect(fetchProviderDetail(films, "tt0069293")).rejects.toThrow("A Wikidata id looks like");
    state.status = 429;
    await expect(searchProvider(films, { text: "Solaris", level: "work" })).rejects.toMatchObject({ reason: "rate_limited", message: "Wikidata asks to wait before the next call" });
    state.status = null;
    state.offline = true;
    await expect(searchProvider(films, { text: "Solaris", level: "work" })).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("gives up on Wikidata after its time limit", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const late = searchProvider(films, { text: "Solaris", level: "work" });
    const settled = expect(late).rejects.toEqual(new ProviderError("Wikidata did not answer within 20 s", "timeout"));
    await vi.advanceTimersByTimeAsync(20_000);
    await settled;
  });

  it("keeps the film when Commons does not answer for its poster", async () => {
    const base = wikidataFetch(state);
    vi.stubGlobal("fetch", (input: string | URL) => (new URL(String(input)).host === "commons.wikimedia.org" ? Promise.reject(new TypeError("fetch failed")) : base(input)));
    const { proposals } = await fetchProviderDetail(films, SOLARIS);
    expect(proposals.find((p) => p.level === "work")!.fields.image).toBeUndefined();
  });

  it("calls a festival a festival and a country's release theatrical; Wikidata never says", () => {
    expect(releaseFormat("Cannes Film Festival")).toBe("festival");
    expect(releaseFormat("Venice Biennale")).toBe("festival");
    expect(releaseFormat("France")).toBe("theatrical");
    expect(releaseFormat(null)).toBe("other");
    expect(earliestDate([{ time: "+1972-00-00T00:00:00Z", precision: 9 }, { time: "+1971-12-01T00:00:00Z", precision: 11 }])).toEqual({
      precision: "day",
      start: { year: 1971, month: 12, day: 1 },
    });
    expect(earliestDate([])).toBeNull();
  });

  it("says what changed between two answers", () => {
    const year = (y: number) => ({ precision: "year" as const, start: { year: y } });
    const before: FilmProposals = {
      work: {
        title: "Solaris",
        releaseDate: year(1972),
        credits: [
          { wikidataId: "Q1", name: "Donatas Banionis", roleId: "film.cast", characters: [] },
          { wikidataId: "Q2", name: "Jüri Järvet", roleId: "film.cast", characters: [] },
        ],
      },
      runtimeSeconds: 10020,
      releases: [{ releaseDate: year(1972), place: { wikidataId: "Q3", name: "Soviet Union" } }],
    };
    const after: FilmProposals = {
      work: {
        title: "Solaris",
        releaseDate: year(1971),
        credits: [
          { wikidataId: "Q1", name: "Donatas Banionis", roleId: "film.cast", characters: [] },
          { wikidataId: "Q4", name: "Anatoly Solonitsyn", roleId: "film.cast", characters: [] },
        ],
      },
      runtimeSeconds: 10020,
      releases: [],
    };
    expect(filmSourceChanges(before, after)).toEqual([
      "First release: 1972 → 1971",
      "Cast and crew: now names Anatoly Solonitsyn",
      "Cast and crew: no longer names Jüri Järvet",
      "Releases: no longer has 1972, Soviet Union",
    ]);
    expect(filmSourceChanges(before, before)).toEqual([]);
  });
});
