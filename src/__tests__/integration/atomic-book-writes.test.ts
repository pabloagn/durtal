import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import type { WizardBookInput } from "@/lib/validations/wizard";

// Never use DATABASE_URL or load env files: this suite truncates only its own local DB.
const url = process.env.DURTAL_ATOMIC_BOOK_WRITES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln281_test"
  )
    throw new Error("Atomic book write tests require disposable local sln281_test");
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
  CACHE_TAGS: {},
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/s3/covers", () => ({
  processAndUploadCover: vi.fn(),
  deleteFromS3: vi.fn(),
}));

import { createBookFromWizard, isIsbnInUse } from "@/lib/actions/wizard";
import { createEdition, updateEdition } from "@/lib/actions/editions";
import { createAuthor, updateAuthor } from "@/lib/actions/authors";
import {
  createOrder,
  createOrderForNewBook,
  updateOrderStatus,
} from "@/lib/actions/orders";
import { processAndUploadCover, deleteFromS3 } from "@/lib/s3/covers";

const MISSING = "00000000-0000-4000-8000-000000000000";
const ISBN = "9780141182605";

describe.skipIf(!url)("atomic book writes", () => {
  const c = client!;
  let study: string;
  let decadents: string;
  let illness: string;
  let fantastic: string;
  let favourite: string;
  let friend: string;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(processAndUploadCover).mockResolvedValue(null);
    await c`truncate works, authors, subjects, genres, tags, recommenders, locations, collections, venues, orders, activity_events, publishing_houses cascade`;
    [study] = (
      await c`insert into locations(name,type) values ('Study','physical') returning id`
    ).map((r) => r.id);
    [decadents] = (
      await c`insert into collections(name) values ('Decadents') returning id`
    ).map((r) => r.id);
    [illness] = (
      await c`insert into subjects(name,slug) values ('Illness','illness') returning id`
    ).map((r) => r.id);
    [fantastic] = (
      await c`insert into genres(name,slug) values ('Fantastic','fantastic') returning id`
    ).map((r) => r.id);
    [favourite] = (
      await c`insert into tags(name,slug) values ('Favourite','favourite') returning id`
    ).map((r) => r.id);
    [friend] = (
      await c`insert into recommenders(name) values ('A friend') returning id`
    ).map((r) => r.id);
  });

  /** Every row a book can leave behind, so a failed write can prove it wrote nothing. */
  async function counts() {
    const [row] = await c`select
      (select count(*)::int from authors) as authors,
      (select count(*)::int from works) as works,
      (select count(*)::int from editions) as editions,
      (select count(*)::int from instances) as copies,
      (select count(*)::int from collection_editions) as members,
      (select count(*)::int from orders) as orders,
      (select count(*)::int from order_status_history) as history,
      (select count(*)::int from activity_events) as events`;
    return row;
  }
  const nothing = {
    authors: 0,
    works: 0,
    editions: 0,
    copies: 0,
    members: 0,
    orders: 0,
    history: 0,
    events: 0,
  };

  const wizardBook = (overrides: Partial<WizardBookInput> = {}): WizardBookInput => ({
    authorName: "Thomas Mann",
    work: {
      title: "The Magic Mountain",
      originalLanguage: "de",
      recommenderIds: [friend],
    },
    taxonomy: { subjectIds: [illness] },
    edition: {
      title: "The Magic Mountain",
      isbn13: ISBN,
      genreIds: [fantastic],
      tagIds: [favourite],
    },
    copies: [
      { locationId: study, format: "paperback" },
      { locationId: study, format: "hardcover" },
    ],
    collectionIds: [decadents],
    ...overrides,
  });

  describe("the add-book wizard", () => {
    it("adds a new book with its author, taxonomy, edition, copies and collection in one write", async () => {
      const result = await createBookFromWizard(wizardBook());
      expect(result).toMatchObject({
        ok: true,
        slug: "the-magic-mountain-by-thomas-mann",
        coverUnavailable: false,
      });
      if (!result.ok) return;
      expect(await counts()).toMatchObject({
        authors: 1,
        works: 1,
        editions: 1,
        copies: 2,
        members: 1,
      });
      const [book] = await c`select w.kind, w.original_language,
        (select count(*)::int from work_subjects where work_id=w.id) as subjects,
        (select count(*)::int from work_recommenders where work_id=w.id) as recommenders,
        (select count(*)::int from edition_genres where edition_id=${result.editionId}) as genres,
        (select count(*)::int from edition_tags where edition_id=${result.editionId}) as tags
        from works w where w.id=${result.workId}`;
      expect(book).toEqual({
        kind: "book",
        original_language: "de",
        subjects: 1,
        recommenders: 1,
        genres: 1,
        tags: 1,
      });
      const events = await c`select event_key from activity_events order by event_key`;
      expect(events.map((e) => e.event_key)).toEqual([
        "author.created",
        "work.collection_added",
        "work.created",
        "work.edition_added",
        "work.instance_added",
        "work.instance_added",
        "work.taxonomy_added",
      ]);
    });

    it("reuses an author with the same name, whatever the case and accents", async () => {
      const [existing] =
        await c`insert into authors(name,slug) values ('Thomas Mann','thomas-mann') returning id`;
      const result = await createBookFromWizard(wizardBook({ authorName: "thomas  MANN" }));
      expect(result.ok).toBe(true);
      expect(await c`select id from authors`).toEqual([{ id: existing.id }]);
    });

    it("refuses a duplicate ISBN before writing anything", async () => {
      await createBookFromWizard(wizardBook());
      const before = await counts();
      const result = await createBookFromWizard(
        wizardBook({ authorName: "Someone Else", work: { title: "Another Book" } }),
      );
      expect(result).toEqual({
        ok: false,
        error: `An edition with ISBN ${ISBN} already exists ("The Magic Mountain")`,
      });
      expect(await counts()).toEqual(before);
      expect(await isIsbnInUse(`978-0-14-118260-5`)).toEqual({
        inUse: true,
        title: "The Magic Mountain",
      });
      expect(await isIsbnInUse("9780000000002")).toEqual({ inUse: false });
    });

    it("writes nothing when a late part of the book fails, and removes the uploaded cover", async () => {
      vi.mocked(processAndUploadCover).mockImplementation(async (id) => ({
        coverKey: `covers/${id}.jpg`,
        thumbnailKey: `covers/${id}-thumb.jpg`,
        palette: null,
      }));
      // A shelf that does not exist fails the second copy, near the end of the
      // batch: after the author, work, taxonomy, edition and first copy
      const result = await createBookFromWizard(
        wizardBook({
          edition: {
            title: "The Magic Mountain",
            coverSourceUrl: "https://covers.example/mountain.jpg",
          },
          copies: [
            { locationId: study },
            { locationId: study, subLocationId: MISSING },
          ],
        }),
      );
      expect(result).toEqual({
        ok: false,
        error: "Could not add the book. Nothing was saved.",
      });
      expect(await counts()).toEqual(nothing);
      const editionId = vi.mocked(processAndUploadCover).mock.calls[0][0];
      expect(vi.mocked(deleteFromS3).mock.calls.map(([key]) => key).sort()).toEqual([
        `covers/${editionId}-thumb.jpg`,
        `covers/${editionId}.jpg`,
      ]);
    });

    it("keeps the cover source when the download fails, and says so", async () => {
      const result = await createBookFromWizard(
        wizardBook({
          edition: {
            title: "The Magic Mountain",
            coverSourceUrl: "https://covers.example/missing.jpg",
          },
        }),
      );
      expect(result).toMatchObject({ ok: true, coverUnavailable: true });
      if (!result.ok) return;
      const [edition] =
        await c`select cover_source_url, cover_s3_key from editions where id=${result.editionId}`;
      expect(edition).toEqual({
        cover_source_url: "https://covers.example/missing.jpg",
        cover_s3_key: null,
      });
    });

    it("adds an edition and copies to an existing book, and refuses a location that is gone", async () => {
      const first = await createBookFromWizard(wizardBook({ copies: [], collectionIds: [] }));
      if (!first.ok) throw new Error(first.error);
      const result = await createBookFromWizard({
        existingWorkId: first.workId,
        edition: { title: "The Magic Mountain", subtitle: "A Novel" },
        copies: [{ locationId: study }],
      });
      expect(result).toMatchObject({ ok: true, workId: first.workId, slug: first.slug });
      expect(await counts()).toMatchObject({ works: 1, editions: 2, copies: 1 });

      const before = await counts();
      expect(
        await createBookFromWizard({
          existingWorkId: first.workId,
          edition: { title: "Third" },
          copies: [{ locationId: MISSING }],
        }),
      ).toEqual({ ok: false, error: "A selected location no longer exists" });
      expect(
        await createBookFromWizard({
          existingWorkId: MISSING,
          edition: { title: "Nowhere" },
        }),
      ).toEqual({ ok: false, error: "The selected book no longer exists" });
      expect(await counts()).toEqual(before);
    });

    it("creates an edition contributor named twice once, and shares a new name with the book's author", async () => {
      const result = await createBookFromWizard(
        wizardBook({
          authorName: "Italo Calvino",
          work: { title: "Invisible Cities" },
          edition: {
            title: "Invisible Cities",
            contributorIds: [
              { authorName: "William Weaver", role: "translator" },
              { authorName: "william weaver", role: "translator" },
              { authorName: "Italo Calvino", role: "introduction" },
            ],
          },
        }),
      );
      expect(result.ok).toBe(true);
      const names = await c`select a.name, ec.role from edition_contributors ec join authors a on a.id = ec.author_id order by ec.sort_order`;
      expect(names).toEqual([
        { name: "William Weaver", role: "translator" },
        { name: "Italo Calvino", role: "introduction" },
      ]);
      expect((await c`select name from authors order by name`).map((a) => a.name)).toEqual([
        "Italo Calvino",
        "William Weaver",
      ]);
    });
  });

  describe("edition saves", () => {
    async function book() {
      const result = await createBookFromWizard(
        wizardBook({ copies: [], collectionIds: [], edition: { title: "The Magic Mountain" } }),
      );
      if (!result.ok) throw new Error(result.error);
      return result;
    }

    it("leaves no contributor created by name when the edition is refused", async () => {
      const { workId } = await book();
      await createEdition({ workId, title: "First", isbn13: ISBN });
      const before = await counts();
      await expect(
        createEdition({
          workId,
          title: "Duplicate",
          isbn13: ISBN,
          contributorIds: [{ authorName: "H. T. Lowe-Porter", role: "translator" }],
        }),
      ).rejects.toThrow(`An edition with ISBN ${ISBN} already exists ("First")`);
      expect(await counts()).toEqual(before);
    });

    it("removes the uploaded cover when the edition write fails", async () => {
      const { workId } = await book();
      vi.mocked(processAndUploadCover).mockImplementation(async (id) => ({
        coverKey: `covers/${id}.jpg`,
        thumbnailKey: `covers/${id}-thumb.jpg`,
        palette: null,
      }));
      await expect(
        createEdition({
          workId,
          title: "With a cover",
          coverSourceUrl: "https://covers.example/x.jpg",
          genreIds: [MISSING],
        }),
      ).rejects.toThrow();
      expect(vi.mocked(deleteFromS3)).toHaveBeenCalledTimes(2);
      expect(await c`select id from editions where title='With a cover'`).toEqual([]);
    });

    it("saves an edit with its contributors, genres and tags whole or not at all", async () => {
      const { editionId } = await book();
      await updateEdition(editionId, {
        contributorIds: [{ authorName: "H. T. Lowe-Porter", role: "translator" }],
        genreIds: [fantastic],
      });
      const before = await counts();
      await expect(
        updateEdition(editionId, {
          title: "Renamed",
          contributorIds: [{ authorName: "John E. Woods", role: "translator" }],
          tagIds: [MISSING],
        }),
      ).rejects.toThrow();
      expect(await counts()).toEqual(before);
      const [edition] = await c`select title,
        (select string_agg(a.name, ',') from edition_contributors ec join authors a on a.id=ec.author_id where ec.edition_id=e.id) as contributors
        from editions e where e.id=${editionId}`;
      expect(edition).toEqual({ title: "The Magic Mountain", contributors: "H. T. Lowe-Porter" });
    });
  });

  describe("author slugs", () => {
    it("writes the slug with the author and with a new name", async () => {
      const mann = await createAuthor({ name: "Thomas Mann" });
      expect(mann.slug).toBe("thomas-mann");
      expect((await createAuthor({ name: "Thomas Mann" })).slug).toBe("thomas-mann-2");
      await updateAuthor(mann.id, { name: "Heinrich Mann" });
      const [renamed] = await c`select slug from authors where id=${mann.id}`;
      expect(renamed.slug).toBe("heinrich-mann");
      // A name that keeps the same base keeps the author's own slug
      await updateAuthor(mann.id, { name: "Heinrich  Mann" });
      expect((await c`select slug from authors where id=${mann.id}`)[0].slug).toBe(
        "heinrich-mann",
      );
    });
  });

  describe("orders", () => {
    const order = {
      acquisitionMethod: "online_order" as const,
      orderDate: "2026-10-03",
      price: "12.50",
      currency: "EUR",
    };

    it("writes an order with its first history row", async () => {
      const { workId } = await createBookFromWizard(
        wizardBook({ copies: [], collectionIds: [], edition: { title: "The Magic Mountain" } }),
      ).then((r) => (r.ok ? r : Promise.reject(new Error(r.error))));
      const created = await createOrder({ ...order, workId });
      const history = await c`select order_id, from_status, to_status from order_status_history`;
      expect(history).toEqual([
        { order_id: created.id, from_status: null, to_status: "placed" },
      ]);
    });

    it("orders a new book in one write, and leaves no book when the order fails", async () => {
      const { order: created, slug } = await createOrderForNewBook({
        book: { title: "Buddenbrooks", authorName: "Thomas Mann" },
        order,
      });
      expect(slug).toBe("buddenbrooks-by-thomas-mann");
      const [work] =
        await c`select w.catalogue_status, (select count(*)::int from orders o where o.work_id = w.id) as orders from works w where w.slug=${slug}`;
      expect(work).toEqual({ catalogue_status: "on_order", orders: 1 });
      expect(created.status).toBe("placed");

      const before = await counts();
      await expect(
        createOrderForNewBook({
          book: { title: "Lotte in Weimar", authorName: "A New Author" },
          order: { ...order, venueId: MISSING },
        }),
      ).rejects.toThrow();
      expect(await counts()).toEqual(before);
    });

    it("refuses a status change validated against a status that has changed since", async () => {
      const { order: placed } = await createOrderForNewBook({
        book: { title: "Doctor Faustus", authorName: "Thomas Mann" },
        order,
      });
      // Another tab confirmed the order after this one read it as "placed"
      await c`update orders set status = 'confirmed' where id = ${placed.id}`;
      const read = vi.spyOn(testDb!.query.orders, "findFirst");
      read.mockResolvedValueOnce({ ...placed, status: "placed" } as never);
      await expect(updateOrderStatus(placed.id, "cancelled")).rejects.toThrow(
        "The order changed; reload before changing its status",
      );
      read.mockRestore();
      const [stored] = await c`select status from orders where id=${placed.id}`;
      expect(stored.status).toBe("confirmed");
      expect(
        (await c`select to_status from order_status_history where order_id=${placed.id}`).map(
          (h) => h.to_status,
        ),
      ).toEqual(["placed"]);
    });
  });
});
