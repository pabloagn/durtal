import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { FastTrackBookInput } from "@/lib/validations/fast-track";

// Never use DATABASE_URL or load env files: this suite can truncate only its own local DB.
const url = process.env.DURTAL_FAST_TRACK_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln320_test"
  ) {
    throw new Error("Fast Track tests require disposable local sln320_test");
  }
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, p) => {
        if (!testDb) throw new Error("Local test DB required");
        return Reflect.get(testDb, p);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), CACHE_TAGS: {} }));
vi.mock("@/lib/s3/covers", () => ({
  processAndUploadCover: vi.fn(),
  deleteFromS3: vi.fn(),
}));
import { computeAndStoreLayout } from "@/lib/actions/gallery-layouts";
import { fastTrackBook } from "@/lib/actions/fast-track";
import { processAndUploadCover, deleteFromS3 } from "@/lib/s3/covers";

const minimal = (): FastTrackBookInput => ({
  authorName: "Marcel Schwob",
  work: { title: "Spicilège" },
  edition: {},
});

describe.skipIf(!url)("Fast Track with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate works, authors, recommenders, activity_events, gallery_layouts cascade`,
    );
    vi.resetAllMocks();
    vi.mocked(processAndUploadCover).mockResolvedValue(null);
  });
  async function rows() {
    return {
      works: await db.select().from(schema.works),
      editions: await db.select().from(schema.editions),
      authors: await db.select().from(schema.authors),
      copies: await db.select().from(schema.instances),
      events: await db.select().from(schema.activityEvents),
    };
  }
  async function expectEmpty() {
    const saved = await rows();
    expect(saved).toEqual({
      works: [],
      editions: [],
      authors: [],
      copies: [],
      events: [],
    });
  }
  it("concurrent first detail renders share one gallery layout without failing", async () => {
    const workId = randomUUID();
    const layouts = await Promise.all(
      Array.from({ length: 6 }, () => computeAndStoreLayout("work", workId)),
    );
    expect(layouts.every((layout) => layout?.entityId === workId)).toBe(true);
    expect(new Set(layouts.map((layout) => layout?.id)).size).toBe(1);
    expect(await db.select().from(schema.galleryLayouts)).toHaveLength(1);
  });
  it("automatically links Fast Track ISBN publisher text after migration 0025", async () => {
    const name = `Fast Track Press ${randomUUID()}`;
    const [house] = await db
      .insert(schema.publishingHouses)
      .values({ name, slug: `test-${randomUUID()}` })
      .returning();
    const input = minimal();
    input.edition.publisher = name;
    const result = await fastTrackBook(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(
      await db
        .select()
        .from(schema.editionPublishers)
        .where(eq(schema.editionPublishers.editionId, result.editionId)),
    ).toEqual([{ editionId: result.editionId, publisherId: house.id }]);
  });
  it("creates one work and edition with unchanged defaults, no copy, and audit events", async () => {
    const result = await fastTrackBook(minimal());
    expect(result.ok).toBe(true);
    const saved = await rows();
    expect(saved.works).toHaveLength(1);
    expect(saved.works[0]).toMatchObject({
      title: "Spicilège",
      originalLanguage: "en",
      catalogueStatus: "tracked",
      acquisitionPriority: "none",
      isRare: false,
    });
    expect(saved.editions).toHaveLength(1);
    expect(saved.editions[0]).toMatchObject({
      language: "en",
      title: "Spicilège",
      workId: saved.works[0].id,
    });
    expect(saved.copies).toEqual([]);
    expect(saved.authors[0]).toMatchObject({
      name: "Marcel Schwob",
      sortName: "Schwob, Marcel",
    });
    expect(saved.events).toHaveLength(3);
    expect(result).toMatchObject({
      slug: saved.works[0].slug,
      coverUnavailable: false,
    });
  });
  it("preserves every Details choice, multiple recommenders and the ISBN lookup edition", async () => {
    const recommenders = await db
      .insert(schema.recommenders)
      .values([{ name: "Alice" }, { name: "Bob" }])
      .returning();
    const input = minimal();
    input.authorName = "  Marcel Schwob  ";
    input.work = {
      title: "  Edited title  ",
      originalYear: 1896,
      originalLanguage: "fr",
      description: "My description",
      seriesName: "Imaginary lives",
      seriesPosition: "2.5",
      catalogueStatus: "wanted",
      acquisitionPriority: "urgent",
      recommenderIds: recommenders.map((r) => r.id),
      metadataSource: "isbndb",
      metadataSourceId: "9781939663745",
    };
    input.edition = {
      isbn13: "9781939663745",
      publisher: "Wakefield Press",
      publicationYear: 2022,
      language: "en",
      pageCount: 240,
      binding: "paperback",
      metadataSource: "isbndb",
      coverSourceUrl: "https://example.com/cover.jpg",
    };
    vi.mocked(processAndUploadCover).mockResolvedValue({
      coverKey: "test-cover",
      thumbnailKey: "test-thumb",
    });
    const result = await fastTrackBook(input);
    expect(result.ok).toBe(true);
    const saved = await rows();
    const { recommenderIds: _ids, ...expectedWork } = input.work;
    expect(saved.works[0]).toMatchObject({
      ...expectedWork,
      title: "Edited title",
    });
    expect(saved.editions[0]).toMatchObject({
      ...input.edition,
      title: "Edited title",
      coverS3Key: "test-cover",
      thumbnailS3Key: "test-thumb",
    });
    expect(await db.select().from(schema.workRecommenders)).toHaveLength(2);
    expect(saved.copies).toEqual([]);
    expect(processAndUploadCover).toHaveBeenCalledWith(
      saved.editions[0].id,
      input.edition.coverSourceUrl,
    );
    expect(deleteFromS3).not.toHaveBeenCalled();
  });
  it.each([
    "tracked",
    "shortlisted",
    "wanted",
    "on_order",
    "accessioned",
  ] as const)(
    "retains %s without inventing a physical copy",
    async (status) => {
      const input = minimal();
      input.work.catalogueStatus = status;
      expect((await fastTrackBook(input)).ok).toBe(true);
      const saved = await rows();
      expect(saved.works[0].catalogueStatus).toBe(status);
      expect(saved.copies).toEqual([]);
    },
  );
  it("reuses accent-insensitive author matches, as the full wizard does", async () => {
    const [author] = await db
      .insert(schema.authors)
      .values({ name: "Péter Nádas", slug: "peter-nadas" })
      .returning();
    const input = minimal();
    input.authorName = "Peter Nadas";
    expect((await fastTrackBook(input)).ok).toBe(true);
    expect((await rows()).authors).toHaveLength(1);
    expect((await db.select().from(schema.workAuthors))[0].authorId).toBe(
      author.id,
    );
  });
  it("rejects duplicate ISBN before creating another author or work", async () => {
    const input = minimal();
    input.edition.isbn13 = "9781939663745";
    expect((await fastTrackBook(input)).ok).toBe(true);
    input.authorName = "Another Author";
    input.work.title = "Another title";
    expect(await fastTrackBook(input)).toMatchObject({
      ok: false,
      error: expect.stringContaining("already exists"),
    });
    const saved = await rows();
    expect(saved.authors).toHaveLength(1);
    expect(saved.works).toHaveLength(1);
    expect(saved.editions).toHaveLength(1);
  });
  it("rolls back a late edition failure and removes only the newly uploaded cover", async () => {
    await db.execute(
      sql`create function fast_track_reject_edition() returns trigger language plpgsql as $$ begin raise exception 'forced edition failure'; end $$`,
    );
    await db.execute(
      sql`create trigger fast_track_reject before insert on editions for each row execute function fast_track_reject_edition()`,
    );
    vi.mocked(processAndUploadCover).mockResolvedValue({
      coverKey: "new-cover",
      thumbnailKey: "new-thumb",
    });
    const input = minimal();
    input.edition.coverSourceUrl = "https://example.com/cover.jpg";
    try {
      expect((await fastTrackBook(input)).ok).toBe(false);
      await expectEmpty();
      expect(deleteFromS3).toHaveBeenCalledTimes(2);
      expect(deleteFromS3).toHaveBeenCalledWith("new-cover");
      expect(deleteFromS3).toHaveBeenCalledWith("new-thumb");
    } finally {
      await db.execute(sql`drop trigger fast_track_reject on editions`);
      await db.execute(sql`drop function fast_track_reject_edition()`);
    }
    // Correcting/retrying the same draft succeeds once the failure is gone.
    expect((await fastTrackBook(input)).ok).toBe(true);
  });
  it("rolls back everything when a selected recommender was deleted", async () => {
    const input = minimal();
    input.work.recommenderIds = [randomUUID()];
    expect((await fastTrackBook(input)).ok).toBe(false);
    await expectEmpty();
  });
  it("cannot save skipped copy or category drafts passed by a caller", async () => {
    const input = {
      ...minimal(),
      copies: [{ locationId: randomUUID() }],
      collectionIds: [randomUUID()],
      taxonomy: { subjectIds: [randomUUID()] },
      edition: {
        language: "en",
        genreIds: [randomUUID()],
        tagIds: [randomUUID()],
      },
    };
    expect((await fastTrackBook(input)).ok).toBe(true);
    expect((await rows()).copies).toEqual([]);
    expect(await db.select().from(schema.collectionEditions)).toEqual([]);
    expect(await db.select().from(schema.workSubjects)).toEqual([]);
    expect(await db.select().from(schema.editionGenres)).toEqual([]);
    expect(await db.select().from(schema.editionTags)).toEqual([]);
  });
  it("keeps the source URL if cover download is unavailable", async () => {
    const input = minimal();
    input.edition.coverSourceUrl = "https://example.com/cover.jpg";
    expect(await fastTrackBook(input)).toMatchObject({
      ok: true,
      coverUnavailable: true,
    });
    expect((await rows()).editions[0]).toMatchObject({
      coverSourceUrl: input.edition.coverSourceUrl,
      coverS3Key: null,
    });
  });
  it("rejects invalid Details and ISBN without writing anything", async () => {
    for (const input of [
      { ...minimal(), authorName: "   " },
      { ...minimal(), work: { title: "  " } },
      { ...minimal(), work: { title: "Valid", originalYear: 9999 } },
      { ...minimal(), edition: { isbn13: "invalid" } },
    ])
      expect((await fastTrackBook(input)).ok).toBe(false);
    await expectEmpty();
  });
  it("two concurrent requests with the same ISBN leave exactly one complete book", async () => {
    // Different authors/titles avoid testing only the slug constraint.
    const a = minimal();
    a.edition.isbn13 = "9781939663745";
    const b = minimal();
    b.edition.isbn13 = a.edition.isbn13;
    b.authorName = "Other Writer";
    b.work.title = "Other title";
    const result = await Promise.all([fastTrackBook(a), fastTrackBook(b)]);
    expect(result.filter((r) => r.ok)).toHaveLength(1);
    const saved = await rows();
    expect(saved.works).toHaveLength(1);
    expect(saved.editions).toHaveLength(1);
    expect(saved.authors).toHaveLength(1);
    expect(saved.events).toHaveLength(3);
    expect(
      await db
        .select()
        .from(schema.workAuthors)
        .where(eq(schema.workAuthors.workId, saved.works[0].id)),
    ).toHaveLength(1);
  });
});
