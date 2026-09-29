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
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_SERIES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln331_test"
  )
    throw new Error("Series tests require disposable local sln331_test");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local DB required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  cached: (fn: () => unknown) => fn,
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import {
  createWork,
  updateWork,
  getWorks,
  getWorkCount,
} from "@/lib/actions/works";
import { fastTrackBook } from "@/lib/actions/fast-track";
import { recordActivity } from "@/lib/activity/record";
import {
  createSeries,
  updateSeries,
  deleteSeries,
  addWorksToSeries,
  removeWorkFromSeries,
  setSeriesPosition,
  moveSeriesWork,
  getSeriesDetail,
  getOtherWorksInSeries,
  getSeriesList,
  getSeriesSuggestions,
  searchWorksForSeries,
} from "@/lib/actions/series";

describe.skipIf(!url)("series with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate series, works, authors cascade`);
    vi.clearAllMocks();
  });
  async function book(
    title: string,
    extra: Partial<typeof schema.works.$inferInsert> = {},
    author = "Author",
  ) {
    const [work] = await db
      .insert(schema.works)
      .values({ title, ...extra })
      .returning();
    const [a] = await db
      .insert(schema.authors)
      .values({ name: author })
      .onConflictDoNothing()
      .returning();
    const authorId =
      a?.id ??
      (
        await db
          .select()
          .from(schema.authors)
          .where(eq(schema.authors.name, author))
      )[0].id;
    await db.insert(schema.workAuthors).values({ workId: work.id, authorId });
    return work;
  }
  async function make(title: string) {
    const r = await createSeries({ title });
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }
  const read = async (id: string) =>
    (await db.select().from(schema.works).where(eq(schema.works.id, id)))[0];

  it("creates, edits and deletes a series; books stay and lose only series and position", async () => {
    const s = await make("  In Search of Lost Time ");
    expect(s).toMatchObject({
      title: "In Search of Lost Time",
      slug: "in-search-of-lost-time",
      isComplete: false,
    });
    const twin = await make("In Search of Lost Time");
    expect(twin.slug).toBe("in-search-of-lost-time-2");
    expect(await createSeries({ title: " " })).toMatchObject({ ok: false });
    const edited = await updateSeries(s.id, {
      title: "À la recherche",
      originalTitle: "",
      totalVolumes: 7,
      isComplete: true,
      description: "Proust",
    });
    expect(edited).toMatchObject({
      ok: true,
      value: {
        title: "À la recherche",
        originalTitle: null,
        totalVolumes: 7,
        isComplete: true,
        slug: "in-search-of-lost-time",
      },
    });
    const w = await book("Swann's Way", { rating: 5 });
    await addWorksToSeries(s.id, [w.id]);
    await deleteSeries(s.id);
    expect(await getSeriesDetail(s.id)).toBeUndefined();
    expect(await read(w.id)).toMatchObject({
      seriesId: null,
      seriesPosition: null,
      rating: 5,
      title: "Swann's Way",
    });
    expect(recordActivity).toHaveBeenCalledWith(
      "work",
      w.id,
      "work.series_changed",
      { oldValue: s.id, newValue: null },
    );
  });

  it("adds books after the highest position, moves books from another series, and ignores members", async () => {
    const s = await make("My Struggle");
    const other = await make("Other");
    const a = await book("A Death in the Family", {
      seriesId: s.id,
      seriesPosition: "1",
    });
    const b = await book("A Man in Love", {
      seriesId: s.id,
      seriesPosition: "2.5",
    });
    const c = await book("Boyhood Island", {
      seriesId: other.id,
      seriesPosition: "9",
    });
    const d = await book("Dancing in the Dark");
    expect(await addWorksToSeries(s.id, [d.id, c.id, a.id, d.id])).toEqual({
      added: 2,
    });
    expect((await read(d.id)).seriesPosition).toBe("3");
    expect(await read(c.id)).toMatchObject({
      seriesId: s.id,
      seriesPosition: "4",
    });
    expect((await read(b.id)).seriesPosition).toBe("2.5");
    await expect(
      addWorksToSeries("00000000-0000-4000-8000-000000000000", [d.id]),
    ).rejects.toThrow();
    expect(await removeWorkFromSeries(s.id, c.id)).toEqual({ removed: 1 });
    expect(await read(c.id)).toMatchObject({
      seriesId: null,
      seriesPosition: null,
    });
    expect(await removeWorkFromSeries(s.id, c.id)).toEqual({ removed: 0 });
  });

  it("orders books numerically, edits positions, and moves books", async () => {
    const s = await make("Numbers");
    const ten = await book("Ten", { seriesId: s.id, seriesPosition: "10" });
    const two = await book("Two", { seriesId: s.id, seriesPosition: "2" });
    const half = await book("Two and a half", {
      seriesId: s.id,
      seriesPosition: "2.5",
    });
    const none = await book("Unplaced", { seriesId: s.id });
    const order = async () =>
      (await getSeriesDetail(s.id))!.works.map((w) => w.title);
    expect(await order()).toEqual(["Two", "Two and a half", "Ten", "Unplaced"]);
    expect(await setSeriesPosition(s.id, ten.id, "abc")).toMatchObject({
      ok: false,
    });
    expect(await setSeriesPosition(s.id, ten.id, " 1 ")).toEqual({
      ok: true,
      value: "1",
    });
    expect(await order()).toEqual(["Ten", "Two", "Two and a half", "Unplaced"]);
    // One member has no position: the series is numbered first, then swapped.
    await moveSeriesWork(s.id, none.id, -1);
    expect(await order()).toEqual(["Ten", "Two", "Unplaced", "Two and a half"]);
    expect((await read(none.id)).seriesPosition).toBe("3");
    expect((await read(half.id)).seriesPosition).toBe("4");
    await moveSeriesWork(s.id, ten.id, -1); // already first: no change
    expect(await order()).toEqual(["Ten", "Two", "Unplaced", "Two and a half"]);
    expect((await read(two.id)).seriesPosition).toBe("2");
  });

  it("suggests books whose titles match series parts, ignoring accents, flags other series", async () => {
    const pair = await make("Blood Meridian and The Road");
    const trilogy = await make("Trilogy: Molloy, Malone Dies, The Unnamable");
    const rulfo = await make("Pedro Páramo and The Plain in Flames");
    const elsewhere = await make("Elsewhere");
    const meridian = await book("Blood Meridian");
    await book("The Road", { seriesId: pair.id });
    await book("Molloy");
    await book("Malone Dies", { seriesId: elsewhere.id });
    await book("Pedro Paramo");
    await book("Unrelated");
    const all = await getSeriesSuggestions();
    expect(
      all.map((x) => [x.seriesTitle, x.workTitle, x.currentSeriesTitle]),
    ).toEqual([
      ["Blood Meridian and The Road", "Blood Meridian", null],
      ["Pedro Páramo and The Plain in Flames", "Pedro Paramo", null],
      // In the order the series title names them, not alphabetical
      ["Trilogy: Molloy, Malone Dies, The Unnamable", "Molloy", null],
      [
        "Trilogy: Molloy, Malone Dies, The Unnamable",
        "Malone Dies",
        "Elsewhere",
      ],
    ]);
    const one = await getSeriesSuggestions(pair.id);
    expect(one.map((x) => x.workId)).toEqual([meridian.id]);
    expect((await getSeriesSuggestions(rulfo.id))[0].authors).toBe("Author");
    expect(await getSeriesSuggestions(trilogy.id)).toHaveLength(2);
  });

  it("lists series with counts and covers, and finds books for the picker", async () => {
    const s = await make("The Alexandria Quartet");
    await make("Empty");
    const justine = await book(
      "Justine",
      { seriesId: s.id, seriesPosition: "1" },
      "Lawrence Durrell",
    );
    await db
      .insert(schema.media)
      .values({ workId: justine.id, type: "poster", s3Key: "justine.webp" });
    const { rows, total } = await getSeriesList({ sort: "books" });
    expect(total).toBe(2);
    expect(rows[0]).toMatchObject({
      title: "The Alexandria Quartet",
      bookCount: 1,
      ownedCount: 0,
      covers: ["justine.webp"],
    });
    expect(
      (await getSeriesList({ search: "alexandra quartet" })).rows.map(
        (r) => r.title,
      ),
    ).toEqual(["The Alexandria Quartet"]);
    const found = await searchWorksForSeries("durrell");
    expect(found.map((w) => [w.title, w.seriesTitle, w.cover])).toEqual([
      ["Justine", "The Alexandria Quartet", "justine.webp"],
    ]);
  });
  it("creates a real series through normal book creation and reuses an exact normalized title", async () => {
    const [author] = await db
      .insert(schema.authors)
      .values({ name: "Series Author" })
      .returning();
    const one = await createWork({
      title: "Volume One",
      authorIds: [{ authorId: author.id }],
      seriesName: "  On the Calculation   of Volume ",
      seriesPosition: "1",
    });
    const two = await createWork({
      title: "Volume Two",
      authorIds: [{ authorId: author.id }],
      seriesName: "on the calculation of volume",
      seriesPosition: "2",
    });
    expect(one.seriesId).toBeTruthy();
    expect(two.seriesId).toBe(one.seriesId);
    expect(one.seriesName).toBeNull();
    expect(
      (await getWorks({ search: "calculation of volume" }))
        .map((w) => w.id)
        .sort(),
    ).toEqual([one.id, two.id].sort());
    expect(await getWorkCount("calculation of volume")).toBe(2);
    const detail = await getSeriesDetail(one.seriesId!);
    expect(detail?.works.map((w) => w.seriesPosition)).toEqual(["1", "2"]);
  });
  it("edits, changes and clears series without stale legacy names returning", async () => {
    const w = await book("Editable", {
      seriesName: "Legacy",
      seriesPosition: "2",
    });
    await updateWork(w.id, {
      seriesName: "New Series",
      seriesId: null,
      seriesPosition: "2",
    });
    const saved = await db.query.works.findFirst({
      where: eq(schema.works.id, w.id),
    });
    expect(saved?.seriesId).toBeTruthy();
    expect(saved?.seriesName).toBeNull();
    await updateWork(w.id, { rating: 4 });
    expect(
      (await db.query.works.findFirst({ where: eq(schema.works.id, w.id) }))
        ?.seriesId,
    ).toBe(saved?.seriesId);
    await updateWork(w.id, { seriesId: null });
    expect(
      await db.query.works.findFirst({ where: eq(schema.works.id, w.id) }),
    ).toMatchObject({
      seriesId: null,
      seriesName: null,
      seriesPosition: null,
      rating: 4,
    });
  });
  it("serializes concurrent series creation and orders sibling works numerically", async () => {
    const books = await Promise.all(
      ["10", "2.5", "2", "1"].map((n) => book(`Volume ${n}`)),
    );
    await Promise.all(
      books.map((b, i) =>
        updateWork(b.id, {
          seriesName: "Concurrent Series",
          seriesPosition: ["10", "2.5", "2", "1"][i],
        }),
      ),
    );
    const all = await db.select().from(schema.series);
    expect(all).toHaveLength(1);
    const siblings = await getOtherWorksInSeries(all[0].id, books[2].id);
    expect(siblings.map((w) => w.seriesPosition)).toEqual(["1", "2.5", "10"]);
  });
  it("rejects invalid positions before creating any series", async () => {
    const w = await book("Bad input");
    await expect(
      updateWork(w.id, { seriesName: "Must not exist", seriesPosition: "two" }),
    ).rejects.toThrow();
    expect(await db.select().from(schema.series)).toHaveLength(0);
  });
  it("rolls back a newly created series when Fast Track cannot save the book", async () => {
    const result = await fastTrackBook({
      authorName: "An Author",
      work: {
        title: "Atomic",
        seriesName: "Not committed",
        seriesPosition: "1",
        recommenderIds: ["10000000-0000-4000-8000-000000000001"],
      },
      edition: {},
    });
    expect(result.ok).toBe(false);
    expect(await db.select().from(schema.series)).toHaveLength(0);
  });
  it("Fast Track creates the normalized series and retains its position", async () => {
    const result = await fastTrackBook({
      authorName: "An Author",
      work: {
        title: "Fast Volume",
        seriesName: "Fast Series",
        seriesPosition: "3",
      },
      edition: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const w = await db.query.works.findFirst({
      where: eq(schema.works.id, result.workId),
    });
    expect(w?.seriesId).toBeTruthy();
    expect(w?.seriesName).toBeNull();
    expect(w?.seriesPosition).toBe("3");
  });
});
