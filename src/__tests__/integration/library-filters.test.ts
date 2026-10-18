import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_LIBRARY_FILTERS_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln405_library_filters");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln405_library_filters")
    throw new Error("Library filter tests require a disposable local sln405_library_filters database");
}
// Each query the app sends, while a test listens
let debugHook: ((query: string) => void) | null = null;
const client = url
  ? postgres(url, { prepare: false, max: 4, onnotice: () => {}, debug: (_connection, query) => debugHook?.(query) })
  : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, prop) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, prop);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
// Images: a key names its dominant colour ("…/red.webp"); "broken" fails
vi.mock("@/lib/s3/covers", () => ({
  uploadToS3: vi.fn(),
  deleteFromS3: vi.fn(),
  getPresignedUploadUrl: vi.fn(),
  processAndUploadCover: vi.fn(),
  storeRawCover: vi.fn(),
  getS3Object: vi.fn(async (key: string) => {
    if (key.includes("broken")) throw new Error("The specified key does not exist.");
    return { body: { transformToByteArray: async () => new TextEncoder().encode(key) } };
  }),
}));
vi.mock("@/lib/color/extract-palette", () => ({
  extractColorPalette: vi.fn(async (buffer: Buffer) => ({
    dominant: { hex: "#000000", rgb: buffer.toString().includes("red") ? [170, 30, 30] : [30, 60, 140] },
    crystal: [],
    extractedAt: "2026-10-05T00:00:00Z",
  })),
}));
import { getWorks, getWorkCount, type WorkFilters } from "@/lib/actions/works";
import { getWorksForTimeline } from "@/lib/actions/work-timeline";
import { getLibraryFilterOptions } from "@/lib/actions/library-filters";
import { backfillCoverColors } from "@/lib/color/backfill";
import { parseBookFilters } from "@/lib/library/filter-params";
import { GET as listWorks } from "@/app/api/works/route";
import { POST as backfillRoute } from "@/app/api/media/backfill-palettes/route";
import { setActiveMedia } from "@/lib/actions/media";

function palette(rgb: [number, number, number]) {
  return { dominant: { hex: "#000000", rgb }, crystal: [], extractedAt: "2026-10-05T00:00:00Z" };
}

// The library's filters (SLN-405): copies, languages, years, series,
// taxonomy and cover colour, the same in the list, its count, the timeline
// and the API, with PostgreSQL.

describe.skipIf(!url)("library filters with PostgreSQL", () => {
  const db = testDb!;
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln405_library_filters");
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  let serial = 0;
  let study = "";
  let kindle = "";
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln405_library_filters", { emptyLocations: true });
    study = await value(`insert into locations(name, type) values ('Study', 'physical') returning id`);
    kindle = await value(`insert into locations(name, type) values ('Kindle', 'digital') returning id`);
  }, 30000);

  const book = (title: string, { language = "en", year = 1900 as number | null, seriesName = null as string | null } = {}) =>
    value(`insert into works(title, slug, original_language, original_year, series_name, catalogue_status) values ($1, $2, $3, $4, $5, 'accessioned') returning id`, [
      title,
      `book-${++serial}`,
      language,
      year,
      seriesName,
    ]);
  const edition = (workId: string, { language = "en", thumb = null as string | null, color = null as string | null, created = "2026-01-01" } = {}) =>
    value(`insert into editions(work_id, title, language, thumbnail_s3_key, cover_color_bucket, created_at) values ($1, 'E', $2, $3, $4, $5) returning id`, [
      workId,
      language,
      thumb,
      color,
      created,
    ]);
  const copy = (editionId: string, { at = study, format = "paperback", status = "available", signed = false, first = false } = {}) =>
    q(`insert into instances(edition_id, location_id, format, status, is_signed, is_first_printing) values ($1, $2, $3, $4, $5, $6)`, [
      editionId,
      at,
      format,
      status,
      signed,
      first,
    ]);
  const poster = (workId: string, { color = null as string | null, active = true, key = "gold/p.webp", palette: p = null as object | null } = {}) =>
    q(`insert into media(work_id, type, s3_key, is_active, color_bucket, color_palette) values ($1, 'poster', $2, $3, $4, $5)`, [
      workId,
      key,
      active,
      color,
      p ? JSON.stringify(p) : null,
    ]);
  const titles = async (filters: WorkFilters) =>
    (await getWorks({ filters, sort: "title", limit: 100 })).map((w) => w.title).sort();
  const fromUrl = (query: string) => parseBookFilters(new URLSearchParams(query)).filters;

  it("searches the timeline as the list: title, author and series, accents and case ignored (SLN-881)", async () => {
    const rebours = await book("À rebours", { year: 1884 });
    await book("Nadja", { year: 1928, seriesName: "Surréalistes" });
    await book("Ulysses", { year: 1922 });
    const [author] = await db.insert(schema.authors).values({ name: "Joris-Karl Huÿsmans" }).returning();
    await db.insert(schema.workAuthors).values({ workId: rebours, authorId: author.id });
    const search = async (text: string) => (await getWorksForTimeline({ search: text })).map((w) => w.title);
    expect(await search("A REBOURS")).toEqual(["À rebours"]);
    expect(await search("huysmans")).toEqual(["À rebours"]);
    expect(await search("surrealistes")).toEqual(["Nadja"]);
    expect(await search("")).toEqual(["À rebours", "Ulysses", "Nadja"]);
  });

  it("filters by edition language, original language, first published years and series", async () => {
    const quixote = await book("Quixote", { language: "es", year: 1605 });
    await edition(quixote, { language: "fr" });
    await edition(quixote, { language: "es" });
    const nadja = await book("Nadja", { language: "fr", year: 1928, seriesName: "Surrealists" });
    await edition(nadja, { language: "fr" });
    const ulysses = await book("Ulysses", { language: "en", year: 1922 });
    await edition(ulysses, { language: "en" });

    expect(await titles({ languages: ["fr"] })).toEqual(["Nadja", "Quixote"]);
    expect(await titles({ languages: ["es", "en"] })).toEqual(["Quixote", "Ulysses"]);
    expect(await titles({ originalLanguages: ["fr"] })).toEqual(["Nadja"]);
    expect(await titles({ yearFrom: 1900 })).toEqual(["Nadja", "Ulysses"]);
    expect(await titles({ yearFrom: 1600, yearTo: 1925 })).toEqual(["Quixote", "Ulysses"]);
    expect(await titles({ series: "in" })).toEqual(["Nadja"]);
    expect(await titles({ series: "none" })).toEqual(["Quixote", "Ulysses"]);
    // From the URL: reversed years are swapped
    expect(await titles(fromUrl("lang=fr&yearFrom=1925&yearTo=1600"))).toEqual(["Quixote"]);
  });

  it("filters by a writer's country; a translator's does not count, and the option counts the same books (SLN-742)", async () => {
    const france = await value(`insert into countries(name, alpha_2, alpha_3) values ('France', 'FR', 'FRA') returning id`);
    const belgium = await value(`insert into countries(name, alpha_2, alpha_3) values ('Belgium', 'BE', 'BEL') returning id`);
    const person = (name: string, country: string) =>
      value(`insert into authors(name, slug, nationality_id) values ($1, $2, $3) returning id`, [name, `person-${++serial}`, country]);
    const huysmans = await person("Huysmans", france);
    const rodenbach = await person("Rodenbach", belgium);
    const translator = await person("Translator", france);
    const writes = (workId: string, authorId: string) =>
      q(`insert into work_authors(work_id, author_id, role, sort_order) values ($1, $2, 'author', 0)`, [workId, authorId]);

    const enRoute = await book("En Route", { language: "fr" });
    await writes(enRoute, huysmans);
    const bruges = await book("Bruges-la-Morte", { language: "fr" });
    await writes(bruges, rodenbach);
    await q(`insert into edition_contributors(edition_id, author_id, role, sort_order) values ($1, $2, 'translator', 0)`, [await edition(bruges), translator]);
    await book("Anonymous");

    expect(await titles(fromUrl("authorCountry=FR"))).toEqual(["En Route"]);
    expect(await titles(fromUrl("authorCountry=FR,BE"))).toEqual(["Bruges-la-Morte", "En Route"]);
    expect((await getLibraryFilterOptions()).authorCountries).toEqual([
      { value: "BE", label: "Belgium", count: 1 },
      { value: "FR", label: "France", count: 1 },
    ]);
  });

  it("filters by held copies: place, format, signed and first printing, all on one copy", async () => {
    const a = await book("Signed paperback in the study");
    await copy(await edition(a), { signed: true });
    const b = await book("First hardcover in the study, ebook on the Kindle");
    const be = await edition(b);
    await copy(be, { format: "hardcover", first: true });
    await copy(be, { at: kindle, format: "ebook" });
    const gone = await book("Signed, but sold");
    await copy(await edition(gone), { signed: true, status: "deaccessioned" });

    expect(await titles({ locationIds: [kindle] })).toEqual(["First hardcover in the study, ebook on the Kindle"]);
    expect(await titles({ formats: ["hardcover", "paperback"] })).toEqual([
      "First hardcover in the study, ebook on the Kindle",
      "Signed paperback in the study",
    ]);
    expect(await titles({ copyFlags: ["signed"] })).toEqual(["Signed paperback in the study"]);
    expect(await titles({ copyFlags: ["first"], locationIds: [study] })).toEqual(["First hardcover in the study, ebook on the Kindle"]);
    // The first printing is in the study, not on the Kindle
    expect(await titles({ copyFlags: ["first"], locationIds: [kindle] })).toEqual([]);
    expect(await titles({ formats: ["ebook"], locationIds: [kindle] })).toEqual(["First hardcover in the study, ebook on the Kindle"]);
  });

  it("filters by taxonomy; a broader category keeps the books under its narrower ones", async () => {
    const fiction = await value(`insert into book_categories(name, slug, level) values ('Fiction', 'fiction', 1) returning id`);
    const gothic = await value(`insert into book_categories(name, slug, level, parent_id) values ('Gothic', 'gothic', 2, $1) returning id`, [fiction]);
    const war = await value(`insert into subjects(name, slug) values ('War', 'war') returning id`);
    const a = await book("Gothic novel");
    await q(`insert into work_categories(work_id, category_id) values ($1, $2)`, [a, gothic]);
    const b = await book("Plain fiction about war");
    await q(`insert into work_categories(work_id, category_id) values ($1, $2)`, [b, fiction]);
    await q(`insert into work_subjects(work_id, subject_id) values ($1, $2)`, [b, war]);
    await book("Nothing");

    expect(await titles({ taxonomy: { category: [fiction] } })).toEqual(["Gothic novel", "Plain fiction about war"]);
    expect(await titles({ taxonomy: { category: [gothic] } })).toEqual(["Gothic novel"]);
    expect(await titles({ taxonomy: { category: [fiction], subject: [war] } })).toEqual(["Plain fiction about war"]);
    expect(await titles(fromUrl(`category=${gothic}`))).toEqual(["Gothic novel"]);

    const options = await getLibraryFilterOptions();
    expect(options.taxonomy.category).toEqual([
      { value: fiction, label: "Fiction", count: 2 },
      { value: gothic, label: "Fiction › Gothic", count: 1 },
    ]);
    expect(options.taxonomy.subject).toEqual([{ value: war, label: "War", count: 1 }]);
    expect(options.taxonomy.keyword).toEqual([]);
  });

  it("matches the colour of the cover the card shows: the poster's, else the first edition's", async () => {
    const posterRed = await book("Poster red, edition blue");
    await poster(posterRed, { color: "red" });
    await edition(posterRed, { thumb: "gold/covers/a/thumb.webp", color: "blue" });
    const inactive = await book("Inactive red poster, edition blue");
    await poster(inactive, { color: "red", active: false });
    await edition(inactive, { thumb: "gold/covers/b/thumb.webp", color: "blue" });
    const first = await book("First edition green, later one red");
    await edition(first, { thumb: "gold/covers/c/thumb.webp", color: "green", created: "2020-01-01" });
    await edition(first, { thumb: "gold/covers/d/thumb.webp", color: "red", created: "2024-01-01" });
    const unread = await book("Poster without a colour yet");
    await poster(unread);
    await edition(unread, { thumb: "gold/covers/e/thumb.webp", color: "red" });
    const noCover = await book("No cover, a stale colour");
    await edition(noCover, { color: "red" });

    expect(await titles({ colors: ["red"] })).toEqual(["Poster red, edition blue"]);
    expect(await titles({ colors: ["blue"] })).toEqual(["Inactive red poster, edition blue"]);
    expect(await titles({ colors: ["green", "blue"] })).toEqual(["First edition green, later one red", "Inactive red poster, edition blue"]);
    // The card's first edition is the same one
    const [card] = await getWorks({ filters: { colors: ["green"] }, limit: 10 });
    expect(card.editions[0].thumbnailS3Key).toBe("gold/covers/c/thumb.webp");

    expect((await getLibraryFilterOptions()).colors).toEqual({ red: 1, blue: 1, green: 1 });
  });

  it("keeps the list, its count, the timeline and the API in step", async () => {
    for (const [title, lang, color] of [
      ["A", "fr", "red"],
      ["B", "fr", "blue"],
      ["C", "en", "red"],
    ] as const) {
      const id = await book(title, { year: 1950 });
      await copy(await edition(id, { language: lang, thumb: `gold/${title}.webp`, color }));
    }
    const filters: WorkFilters = { languages: ["fr"], colors: ["red"], holding: "owned" };
    expect(await titles(filters)).toEqual(["A"]);
    expect(await getWorkCount(undefined, filters)).toBe(1);
    expect((await getWorksForTimeline({ filters })).map((w) => w.title)).toEqual(["A"]);

    const res = await listWorks(new NextRequest("http://localhost/api/works?lang=fr&color=red&holding=owned"));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.works.map((w: { title: string }) => w.title)).toEqual(["A"]);

    const bad = await listWorks(new NextRequest("http://localhost/api/works?color=teal"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0].path[0]).toBe("color");
  });

  // SLN-750: the search's related-table matches are subqueries of the list's
  // own where clause, so a search costs no round trip before the list query.
  // These are the matches it had before, one query kind at a time.
  it("searches title, series, author, ISBN and publisher in the list query itself", async () => {
    const searchBook = async (title: string, { series = null as string | null, isbn13 = null as string | null, publisher = null as string | null } = {}) => {
      const id = await book(title, { seriesName: series });
      const ed = await value(`insert into editions(work_id, title, language, isbn_13, publisher) values ($1, 'E', 'en', $2, $3) returning id`, [id, isbn13, publisher]);
      return { id, ed };
    };
    const ficciones = await searchBook("Ficciones", { isbn13: "9780802130303", publisher: "Grove Press" });
    await searchBook("Labyrinths", { series: "Ficciones and more" });
    const aleph = await searchBook("The Aleph", { isbn13: "9780142437889" });
    const satantango = await searchBook("Satantango", { publisher: "New Directions" });
    await searchBook("Unrelated");
    const borges = await value(`insert into authors(name, slug) values ('Jorge Luis Borges', 'jorge-luis-borges') returning id`);
    for (const w of [ficciones.id, aleph.id]) await q(`insert into work_authors(work_id, author_id) values ($1, $2)`, [w, borges]);
    const nyrb = await value(`insert into publishing_houses(name, slug) values ('New York Review Books', 'nyrb') returning id`);
    await q(`insert into publisher_aliases(publisher_id, name) values ($1, 'NYRB Classics')`, [nyrb]);
    await q(`insert into edition_publishers(edition_id, publisher_id) values ($1, $2)`, [satantango.ed, nyrb]);

    const found = async (search: string) => {
      const list = (await getWorks({ search, sort: "title", limit: 100 })).map((w) => w.title).sort();
      expect(await getWorkCount(search)).toBe(list.length);
      return list;
    };
    // Title, and series name
    expect(await found("ficciones")).toEqual(["Ficciones", "Labyrinths"]);
    // Author, accents and word order aside
    expect(await found("borges jorge")).toEqual(["Ficciones", "The Aleph"]);
    // A whole ISBN finds its book alone; a hyphenated or partial one too
    expect(await found("978-0-14-243788-9")).toEqual(["The Aleph"]);
    expect(await found("0802130")).toEqual(["Ficciones"]);
    expect(await found("9780000000000")).toEqual([]);
    // Publisher text, the publisher record and its alias
    expect(await found("grove")).toEqual(["Ficciones"]);
    expect(await found("new york review")).toEqual(["Satantango"]);
    expect(await found("nyrb")).toEqual(["Satantango"]);
    expect(await found("nothing matches this")).toEqual([]);

    // The list and its count each run as one query, with or without a search
    const asked: string[] = [];
    const listen = (query: string) => asked.push(query);
    debugHook = listen;
    try {
      await Promise.all([getWorks({ search: "borges", sort: "title", limit: 100 }), getWorkCount("borges")]);
      const searched = asked.length;
      asked.length = 0;
      await Promise.all([getWorks({ sort: "title", limit: 100 }), getWorkCount(undefined)]);
      expect(searched).toBe(asked.length);
    } finally {
      debugHook = null;
    }
  });

  // SLN-765: titles, series and publishers fold accents, case and
  // punctuation as author names do, and every plain match stays
  it("finds titles, series and publishers whatever their accents", async () => {
    const withEdition = async (title: string, { series = null as string | null, publisher = null as string | null } = {}) => {
      const id = await book(title, { seriesName: series });
      const ed = await value(`insert into editions(work_id, title, language, publisher) values ($1, 'E', 'fr', $2) returning id`, [id, publisher]);
      return { id, ed };
    };
    await withEdition("À rebours", { publisher: "Éditions de Minuit" });
    await withEdition("L'Œuvre", { series: "Les Rougon-Macquart" });
    const labas = await withEdition("Là-bas");
    const nana = await withEdition("Nana");
    await withEdition("100% Pure");
    await withEdition("Unrelated");
    const cycle = await value(`insert into series(title, slug) values ('Cycle de Durtal', 'cycle-de-durtal') returning id`);
    await q(`update works set series_id = $1 where id = $2`, [cycle, labas.id]);
    const house = await value(`insert into publishing_houses(name, slug) values ('Éditions Gallimard', 'gallimard') returning id`);
    await q(`insert into publisher_aliases(publisher_id, name) values ($1, 'Librairie Générale Française')`, [house]);
    await q(`insert into edition_publishers(edition_id, publisher_id) values ($1, $2)`, [nana.ed, house]);

    const found = async (search: string) => {
      const list = (await getWorks({ search, sort: "title", limit: 100 })).map((w) => w.title).sort();
      expect(await getWorkCount(search)).toBe(list.length);
      return list;
    };
    // Title, without its accents or in capitals, and as typed
    expect(await found("a rebours")).toEqual(["À rebours"]);
    expect(await found("A REBOURS")).toEqual(["À rebours"]);
    expect(await found("À rebours")).toEqual(["À rebours"]);
    expect(await found("l oeuvre")).toEqual(["L'Œuvre"]);
    expect(await found("la bas")).toEqual(["Là-bas"]);
    // Series name and series record
    expect(await found("rougon macquart")).toEqual(["L'Œuvre"]);
    expect(await found("cycle de durtal")).toEqual(["Là-bas"]);
    // Publisher text, the publisher record and its alias
    expect(await found("editions de minuit")).toEqual(["À rebours"]);
    expect(await found("minuit")).toEqual(["À rebours"]);
    expect(await found("editions gallimard")).toEqual(["Nana"]);
    expect(await found("librairie generale")).toEqual(["Nana"]);
    // Punctuation is still matched as typed, and alone it does not match everything
    expect(await found("100%")).toEqual(["100% Pure"]);
    expect(await found("%")).toEqual(["100% Pure"]);
    expect(await found("—")).toEqual([]);
    expect(await found("nothing like this")).toEqual([]);
  });

  it("refuses filters the browser sends back that the page would not have parsed", async () => {
    await expect(getWorksForTimeline({ filters: { colors: ["teal" as "red"] } })).rejects.toThrow();
    await expect(getWorksForTimeline({ filters: { locationIds: ["not-an-id"] } })).rejects.toThrow();
  });

  it("counts every option over the books that use it", async () => {
    const a = await book("A", { language: "fr", year: 1850 });
    const ae = await edition(a, { language: "fr" });
    await copy(ae, { signed: true, format: "hardcover" });
    await copy(ae, { at: kindle, format: "ebook" });
    const b = await book("B", { language: "en", year: 1990 });
    await copy(await edition(b, { language: "fr" }), { status: "deaccessioned", signed: true });

    const options = await getLibraryFilterOptions();
    expect(options.languages).toEqual([{ value: "fr", label: "French", count: 2 }]);
    expect(options.originalLanguages).toEqual([
      { value: "en", label: "English", count: 1 },
      { value: "fr", label: "French", count: 1 },
    ]);
    expect(options.years).toEqual({ min: 1850, max: 1990 });
    expect(options.locations).toEqual([
      { value: kindle, label: "Kindle", count: 1 },
      { value: study, label: "Study", count: 1 },
    ]);
    expect(options.formats).toEqual({ hardcover: 1, ebook: 1 });
    expect(options.copies).toEqual({ signed: 1, first: 0 });
  });

  it("backfills cover colours: stored palettes first, then the images without one, each read once", async () => {
    const a = await book("Poster with a palette, no colour");
    await poster(a, { palette: palette([20, 120, 40]) });
    const b = await book("Poster without a palette");
    await poster(b, { key: "gold/media/red.webp" });
    const c = await book("Cover without a palette");
    await edition(c, { thumb: "gold/covers/blue.webp" });
    const d = await book("Broken cover");
    await edition(d, { thumb: "gold/covers/broken.webp" });

    const dry = await backfillCoverColors({ dryRun: true });
    expect(dry).toMatchObject({ colored: 1, remaining: { posters: 1, covers: 2 } });
    expect(await value(`select count(*)::int from media where color_bucket is not null`)).toBe(0);

    const run = await backfillCoverColors();
    expect(run).toMatchObject({
      colored: 1,
      posters: { processed: 1, failed: 0 },
      covers: { processed: 1, failed: 1 },
      remaining: { posters: 0, covers: 1 },
    });
    expect(run.errors[0]).toMatch(/^[0-9a-f-]{36}: The specified key does not exist\.$/);
    expect(await titles({ colors: ["green"] })).toEqual(["Poster with a palette, no colour"]);
    expect(await titles({ colors: ["red"] })).toEqual(["Poster without a palette"]);
    expect(await titles({ colors: ["blue"] })).toEqual(["Cover without a palette"]);

    // A batch reads at most `limit` images, posters first
    const e = await book("Another cover");
    await edition(e, { thumb: "gold/covers/red-2.webp" });
    expect(await backfillCoverColors({ limit: 0 })).toMatchObject({ covers: { processed: 0 }, remaining: { covers: 2 } });
  });

  it("moves a batch past the images it could not read; the route has a dry run (PR #113 review)", async () => {
    for (const [title, key] of [
      ["Broken one", "gold/covers/broken-1.webp"],
      ["Broken two", "gold/covers/broken-2.webp"],
      ["The red one", "gold/covers/red.webp"],
    ])
      await edition(await book(title), { thumb: key });
    vi.stubEnv("ADMIN_TOKEN", "test-admin-token");
    try {
      const call = async (query: string) => {
        const res = await backfillRoute(
          new NextRequest(`http://localhost/api/media/backfill-palettes?${query}`, {
            method: "POST",
            headers: { "x-admin-token": "test-admin-token" },
          }),
        );
        expect(res.status).toBe(200);
        return res.json();
      };
      const dry = await call("dryRun=1");
      expect(dry).toMatchObject({ remaining: { covers: 3 }, next: null, covers: { processed: 0, failed: 0 } });
      expect(await value(`select count(*)::int from editions where cover_palette is not null`)).toBe(0);

      let next: string | null = null;
      let calls = 0;
      const totals = { processed: 0, failed: 0 };
      do {
        const run = await call(`limit=1${next ? `&after=${encodeURIComponent(next)}` : ""}`);
        totals.processed += run.covers.processed;
        totals.failed += run.covers.failed;
        next = run.next;
        calls++;
      } while (next && calls < 10);
      expect(calls).toBe(4);
      expect(totals).toEqual({ processed: 1, failed: 2 });
      expect(await titles({ colors: ["red"] })).toEqual(["The red one"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reads a poster made active through the shared S3 read, and stores its colour", async () => {
    const a = await book("Two posters");
    await poster(a, { key: "gold/media/blue.webp" });
    await poster(a, { key: "gold/media/red-2.webp", active: false });
    const second = await value(`select id from media where s3_key = 'gold/media/red-2.webp'`);
    await setActiveMedia(second);
    expect(await value(`select color_bucket from media where id = $1`, [second])).toBe("red");
    expect(await titles({ colors: ["red"] })).toEqual(["Two posters"]);
  });

  it("refuses a colour outside the named ones", async () => {
    const a = await book("A");
    await expect(edition(a, { color: "teal" })).rejects.toThrow(/editions_cover_color_bucket_check/);
    await expect(poster(a, { color: "teal" })).rejects.toThrow(/media_color_bucket_check/);
  });
});
