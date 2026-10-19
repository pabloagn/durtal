import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { eq, sql } from "drizzle-orm";
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
import * as schema from "@/lib/db/schema";
import type { WizardBookInput } from "@/lib/validations/wizard";

// Never use DATABASE_URL or load env files: this suite truncates only its own local DB.
const url = process.env.DURTAL_ATOMIC_BOOK_WRITES_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln281_test");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln281_test"
  )
    throw new Error("Atomic book write tests require disposable local sln281_test");
}
const client = url ? postgres(url, { prepare: false, max: 5, onnotice: () => {} }) : null;
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
  CACHE_TAGS: { authors: "ref:authors" },
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
import { invalidate } from "@/lib/cache";
vi.mock("@/lib/s3/client", async () => ({ S3_BUCKET: "local-test", s3: { send: (await import("../s3/cover-stage-fixture")).catalogueSend } }));
import { mintCover, coverBucket, resetCoverBucket } from "../s3/cover-stage-fixture";
import { createHash } from "node:crypto";
import { atomicOn } from "@/lib/db/atomic";
import type { Db } from "@/lib/catalogue/work-store";
import { readEditionWriteSnapshot, editionWriteGuardQueries, editionUpdateQuery } from "@/lib/catalogue/edition-write-guard";
import { loadMatchEdition, saveMatch } from "@/lib/match/save";
import { cleanRecord } from "@/lib/match/source";
const followup = vi.hoisted(() => ({ reject: false }));
vi.mock("@/lib/publishers/resolution", async (original) => {
  const actual = await original<typeof import("@/lib/publishers/resolution")>();
  return { ...actual, autoResolveEditions: async (...args: Parameters<typeof actual.autoResolveEditions>) => {
    if (followup.reject) throw new Error("postcommit publisher follow-up failed");
    return actual.autoResolveEditions(...args);
  } };
});

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
    await resetDisposableDatabase(url!, "sln281_test");
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    resetCoverBucket();
    followup.reject = false;
    vi.mocked(processAndUploadCover).mockResolvedValue(null);
    await resetDisposableDatabase(url!, "sln281_test", { emptyLocations: true });
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
  }, 30000);

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
      // Its identity and research jobs, after the save (SLN-464, SLN-469): an owned book comes first
      expect(await c`select kind, priority, payload->>'reason' as reason from enrichment_jobs where work_id=${result.workId} order by kind`).toEqual([
        { kind: "identity", priority: 10, reason: "created" },
        { kind: "research", priority: 10, reason: "created" },
      ]);
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
        href: expect.stringMatching(/^\/library\/.+/),
      });
      expect(await isIsbnInUse("9780000000002")).toEqual({ inUse: false });
    });

    it("writes nothing when a late part of the book fails, and retains the uploaded cover for reconciliation", async () => {
      vi.mocked(processAndUploadCover).mockImplementation(async (id, url) => mintCover(id, url));
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
      expect(deleteFromS3).not.toHaveBeenCalled();
      expect([...coverBucket.objects.keys()]).toHaveLength(2);
      expect([...coverBucket.objects.keys()].every(key => key.startsWith(`gold/media/edition/${editionId}/cover/attempt-`))).toBe(true);
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
      // A sub-location of another location (SLN-574)
      const [elsewhere] = await c`insert into locations(name,type) values ('Elsewhere','physical') returning id`;
      const [shelf] = await c`insert into sub_locations(location_id,name) values (${elsewhere.id},'Shelf') returning id`;
      expect(
        await createBookFromWizard({
          existingWorkId: first.workId,
          edition: { title: "Third" },
          copies: [{ locationId: study }, { locationId: study, subLocationId: shelf.id }],
        }),
      ).toEqual({ ok: false, error: "The sub-location belongs to another location" });
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

  async function book() {
    const result = await createBookFromWizard(
      wizardBook({ copies: [], collectionIds: [], edition: { title: "The Magic Mountain" } }),
    );
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  describe("edition saves", () => {

    it("queues the book's identity and research jobs for a new edition with an ISBN, and none without", async () => {
      const { workId } = await book();
      await c`delete from enrichment_jobs where work_id=${workId}`;
      await createEdition({ workId, title: "No ISBN" });
      expect(await c`select id from enrichment_jobs where work_id=${workId}`).toEqual([]);
      await createEdition({ workId, title: "With ISBN", isbn13: ISBN });
      expect(await c`select kind, payload->>'reason' as reason from enrichment_jobs where work_id=${workId} order by kind`).toEqual([
        { kind: "identity", reason: "created" },
        { kind: "research", reason: "created" },
      ]);
    });

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

    it("retains the uploaded cover when the edition write fails", async () => {
      const { workId } = await book();
      vi.mocked(processAndUploadCover).mockImplementation(async (id, url) => mintCover(id, url));
      await expect(
        createEdition({
          workId,
          title: "With a cover",
          coverSourceUrl: "https://covers.example/x.jpg",
          genreIds: [MISSING],
        }),
      ).rejects.toThrow();
      expect(deleteFromS3).not.toHaveBeenCalled();
      expect(coverBucket.objects.size).toBe(2);
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

  describe("Add person's id (SLN-1276)", () => {
    it("adds a person once for a repeated id, a resend at the same time included", async () => {
      const id = "3c9b1f2e-5d7a-4b8c-9e0f-1a2b3c4d5e01";
      const { recordActivity } = await import("@/lib/activity/record");
      vi.mocked(recordActivity).mockClear();
      const first = await createAuthor({ name: "Unica Zürn" }, { id });
      expect(first).toMatchObject({ id, slug: "unica-zurn" });
      expect(await createAuthor({ name: "Unica Zürn" }, { id })).toEqual(first);
      const raced = "3c9b1f2e-5d7a-4b8c-9e0f-1a2b3c4d5e02";
      const [x, y] = await Promise.all([createAuthor({ name: "Leonora Carrington" }, { id: raced }), createAuthor({ name: "Leonora Carrington" }, { id: raced })]);
      expect(x).toEqual(y);
      expect(await client!`select count(*)::int as n from authors where name in ('Unica Zürn', 'Leonora Carrington')`).toEqual([{ n: 2 }]);
      expect(vi.mocked(recordActivity).mock.calls.filter((c) => c[2] === "author.created")).toHaveLength(2);
    });
  });

  describe("author slugs", () => {
    it("writes the slug with the author and with a new name", async () => {
      const mann = await createAuthor({ name: "Thomas Mann" });
      expect(mann.slug).toBe("thomas-mann");
      expect((await createAuthor({ name: "Thomas Mann" })).slug).toBe("thomas-mann-2");
      // The new address goes back to the page, which moves to it. The
      // person's pages are read again, or the move to a person with no
      // books is cut short and the page keeps the old name
      vi.mocked(invalidate).mockClear();
      expect((await updateAuthor(mann.id, { name: "Heinrich Mann" })).slug).toBe("heinrich-mann");
      expect(vi.mocked(invalidate).mock.calls.flat()).toContain("ref:authors");
      const [renamed] = await c`select slug from authors where id=${mann.id}`;
      expect(renamed.slug).toBe("heinrich-mann");
      // A name that keeps the same base keeps the author's own slug
      vi.mocked(invalidate).mockClear();
      expect((await updateAuthor(mann.id, { name: "Heinrich  Mann" })).slug).toBeNull();
      expect(vi.mocked(invalidate).mock.calls.flat()).not.toContain("ref:authors");
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
      // Its identity and research jobs, after the save (SLN-464, SLN-469): an ordered book comes second
      expect(
        await c`select j.kind, j.priority from enrichment_jobs j join works w on w.id = j.work_id where w.slug=${slug} order by j.kind`,
      ).toEqual([
        { kind: "identity", priority: 20 },
        { kind: "research", priority: 20 },
      ]);

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
  describe("SLN-572 real cover bytes under guarded catalogue publication", () => {
    const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>(done => { resolve = done; });
      return { promise, resolve };
    }
    async function aliasedBook() {
      const ids = await book();
      const a = await mintCover(ids.editionId, "https://example.com/A.png");
      const full = `gold/covers/${ids.editionId}/cover.webp`, thumb = `gold/covers/${ids.editionId}/thumb.webp`;
      coverBucket.objects.set(full, Buffer.from(coverBucket.objects.get(a.coverKey)!));
      coverBucket.objects.set(thumb, Buffer.from(coverBucket.objects.get(a.thumbnailKey)!));
      await c`update editions set cover_s3_key=${full}, thumbnail_s3_key=${thumb}, cover_source_url='https://example.com/A.png' where id=${ids.editionId}`;
      const [sibling] = await c`insert into works(title,slug) values('Sibling','sibling') returning id`;
      await testDb!.insert(schema.media).values([
        { workId: ids.workId, type: "poster", isActive: true, s3Key: full, thumbnailS3Key: thumb },
        { workId: sibling.id, type: "poster", isActive: true, s3Key: full, thumbnailS3Key: thumb },
      ]);
      const before = await c`select to_jsonb(e) as row from editions e where id=${ids.editionId}`;
      const posters = await c`select to_jsonb(m) as row from media m order by id`;
      return { ...ids, full, thumb, before, posters, hashes: [digest(coverBucket.objects.get(full)!), digest(coverBucket.objects.get(thumb)!)] };
    }
    it.each(["tag", "publisher", "contributor"] as const)("invalid %s rolls back staged B pointers/metadata/links while aliased A hashes stay", async field => {
      const a = await aliasedBook();
      vi.mocked(processAndUploadCover).mockImplementation((id, url) => mintCover(id, url, "#cc0000"));
      const invalid = field === "tag" ? { tagIds: [MISSING] } : field === "publisher" ? { publisherIds: [MISSING] } : { contributorIds: [{ authorId: MISSING, role: "translator" }] };
      await expect(updateEdition(a.editionId, { title: "B", coverSourceUrl: "https://example.com/B.png", ...invalid })).rejects.toThrow();
      expect(await c`select to_jsonb(e) as row from editions e where id=${a.editionId}`).toEqual(a.before);
      expect(await c`select to_jsonb(m) as row from media m order by id`).toEqual(a.posters);
      expect([digest(coverBucket.objects.get(a.full)!), digest(coverBucket.objects.get(a.thumb)!)]).toEqual(a.hashes);
      expect(deleteFromS3).not.toHaveBeenCalled();
    });
    it("winner publishes a complete fresh pair; competing writer on a second client is stale and cannot delete either pair", async () => {
      const a = await aliasedBook();
      const otherClient = postgres(url!, { prepare: false, max: 1, onnotice: () => {} });
      const other = drizzle(otherClient, { schema }) as unknown as Db;
      try {
        const expectedA = await readEditionWriteSnapshot(a.editionId, testDb! as unknown as Db);
        const expectedB = await readEditionWriteSnapshot(a.editionId, other);
        const winner = await mintCover(a.editionId, "https://example.com/B.png", "#cc0000");
        const loser = await mintCover(a.editionId, "https://example.com/C.png", "#00cc00");
        const publish = (conn: Db, expected: typeof expectedA, cover: typeof winner) => atomicOn(conn, d => [
          ...editionWriteGuardQueries(d, expected),
          editionUpdateQuery(d, a.editionId, { title: cover === winner ? "Winner" : "Loser", updatedAt: new Date(), coverS3Key: cover.coverKey, thumbnailS3Key: cover.thumbnailKey }),
        ]);
        await publish(testDb! as unknown as Db, expectedA, winner);
        await expect(publish(other, expectedB, loser)).rejects.toThrow(/changed/);
        const [stored] = await c`select cover_s3_key,thumbnail_s3_key,title from editions where id=${a.editionId}`;
        expect(stored).toEqual({ cover_s3_key: winner.coverKey, thumbnail_s3_key: winner.thumbnailKey, title: "Winner" });
        expect([digest(coverBucket.objects.get(winner.coverKey)!), digest(coverBucket.objects.get(winner.thumbnailKey)!)]).toEqual([winner.cover.sha256, winner.thumbnail.sha256]);
        expect([digest(coverBucket.objects.get(a.full)!), digest(coverBucket.objects.get(a.thumb)!)]).toEqual(a.hashes);
        expect(coverBucket.objects.has(loser.coverKey)).toBe(true);
        expect(await c`select to_jsonb(m) as row from media m order by id`).toEqual(a.posters);
      } finally { await otherClient.end(); }
    });
    it.each(["microsecond", "relationship", "deletion"] as const)("refuses %s drift occurring while actual updateEdition stages", async kind => {
      const a = await aliasedBook(), staged = deferred<void>(), release = deferred<void>();
      if (kind === "microsecond")
        await c`update editions set updated_at='2026-10-10T10:00:00.000000Z'::timestamptz where id=${a.editionId}`;
      vi.mocked(processAndUploadCover).mockImplementation(async (id, url) => {
        const cover = await mintCover(id, url, "#cc0000"); staged.resolve(); await release.promise; return cover;
      });
      const outcome = updateEdition(a.editionId, { title: "Stale", coverSourceUrl: "https://example.com/B.png" }).then(() => null, error => error);
      await staged.promise;
      if (kind === "microsecond") {
        const [old] = await c`select updated_at::text as value from editions where id=${a.editionId}`;
        // Two distinct DB versions within the same JS millisecond.
        await c`update editions set updated_at=date_trunc('milliseconds',updated_at)+interval '1 microsecond' where id=${a.editionId}`;
        expect((await c`select updated_at::text as value from editions where id=${a.editionId}`)[0].value).not.toBe(old.value);
      } else if (kind === "relationship") await c`insert into edition_tags(edition_id,tag_id) values(${a.editionId},${favourite})`;
      else await c`delete from editions where id=${a.editionId}`;
      release.resolve();
      expect(String(await outcome)).toMatch(/changed/);
      expect([digest(coverBucket.objects.get(a.full)!), digest(coverBucket.objects.get(a.thumb)!)]).toEqual(a.hashes);
      expect(deleteFromS3).not.toHaveBeenCalled();
    });
    it("a zero-row UPDATE fails and rolls back preceding relation writes", async () => {
      const a = await aliasedBook(), expected = await readEditionWriteSnapshot(a.editionId, testDb! as unknown as Db);
      await c`create function sln572_skip_update() returns trigger language plpgsql as $$ begin return null; end $$`;
      await c`create trigger sln572_skip_update before update on editions for each row execute function sln572_skip_update()`;
      try {
        await expect(atomicOn(testDb! as unknown as Db, d => [
          ...editionWriteGuardQueries(d, expected),
          d.insert(schema.editionTags).values({ editionId: a.editionId, tagId: favourite }),
          editionUpdateQuery(d, a.editionId, { title: "Suppressed", updatedAt: new Date() }),
        ])).rejects.toThrow(/changed/);
        expect(await c`select * from edition_tags where edition_id=${a.editionId}`).toEqual([]);
      } finally {
        await c`drop trigger sln572_skip_update on editions`;
        await c`drop function sln572_skip_update()`;
      }
    });
    it("saveMatch publishes fresh bytes atomically and refuses stale or duplicate-ISBN publication without altering parent bytes", async () => {
      const a = await aliasedBook();
      const current = await loadMatchEdition(a.editionId);
      const record = cleanRecord({ title: "Matched", coverUrl: "https://example.com/B.png" });
      const rows = [
        { field: "title" as const, current: current.title, next: "Matched", checked: true, note: null, blocked: null },
        { field: "cover" as const, current: current.coverSourceUrl, next: record.coverUrl, checked: true, note: null, blocked: null },
      ];
      const input = { source: "google_books" as const, sourceId: "test", record, rows, accepted: rows.map(row => ({ field: row.field, value: row.next })) };
      vi.mocked(processAndUploadCover).mockImplementation((id, url) => mintCover(id, url, "#cc0000"));
      expect((await saveMatch(current, input)).changed).toBe(2);
      const winner = await c`select cover_s3_key,thumbnail_s3_key from editions where id=${a.editionId}`;
      await expect(saveMatch(current, input)).rejects.toThrow(/changed/);
      expect(await c`select cover_s3_key,thumbnail_s3_key from editions where id=${a.editionId}`).toEqual(winner);
      expect([digest(coverBucket.objects.get(a.full)!), digest(coverBucket.objects.get(a.thumb)!)]).toEqual(a.hashes);
      // Re-read and force an actual unique constraint after staging a complete
      // pair. The cover/source and metadata must roll back together.
      await createEdition({ workId: a.workId, title: "Other ISBN owner", isbn13: "9780306406157" });
      const fresh = await loadMatchEdition(a.editionId);
      const before = await c`select to_jsonb(e) as row from editions e where id=${a.editionId}`;
      const duplicateRows = [rows[1], { field: "isbn13" as const, current: fresh.isbn13, next: "9780306406157", checked: true, note: null, blocked: null }];
      await expect(saveMatch(fresh, { ...input, rows: duplicateRows, accepted: duplicateRows.map(row => ({ field: row.field, value: row.next })) })).rejects.toThrow();
      expect(await c`select to_jsonb(e) as row from editions e where id=${a.editionId}`).toEqual(before);
      expect(deleteFromS3).not.toHaveBeenCalled();
    });
    it("explicit optional/required rematch cover failure preserves existing pointers", async () => {
      const a = await aliasedBook(), record = cleanRecord({ coverUrl: "https://example.com/unavailable.png" });
      const rows = [{ field: "cover" as const, current: "https://example.com/A.png", next: record.coverUrl, checked: true, note: null, blocked: null }];
      const input = { source: "google_books" as const, sourceId: "test", record, rows, accepted: rows.map(row => ({ field: row.field, value: row.next })) };
      vi.mocked(processAndUploadCover).mockResolvedValue(null);
      await expect(saveMatch(await loadMatchEdition(a.editionId), input)).rejects.toThrow("cover could not be downloaded");
      expect((await saveMatch(await loadMatchEdition(a.editionId), { ...input, coverOptional: true })).coverSkipped).toBe(true);
      const [stored] = await c`select cover_s3_key,thumbnail_s3_key,cover_source_url from editions where id=${a.editionId}`;
      expect(stored).toEqual({ cover_s3_key: a.full, thumbnail_s3_key: a.thumb, cover_source_url: "https://example.com/A.png" });
      expect([digest(coverBucket.objects.get(a.full)!), digest(coverBucket.objects.get(a.thumb)!)]).toEqual(a.hashes);
    });
    it("wizard postcommit follow-up failure retains the published cover and exposes its exact recovery paths", async () => {
      vi.mocked(processAndUploadCover).mockImplementation((id, url) => mintCover(id, url));
      followup.reject = true;
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = await createBookFromWizard(wizardBook({ edition: { title: "The Magic Mountain", coverSourceUrl: "https://example.com/B.png" } }));
        expect(result.ok).toBe(false);
        const [published] = await c`select cover_s3_key,thumbnail_s3_key from editions`;
        expect(coverBucket.objects.has(published.cover_s3_key)).toBe(true);
        expect(coverBucket.objects.has(published.thumbnail_s3_key)).toBe(true);
        expect(warning).toHaveBeenCalledWith(expect.stringContaining("retained attempt"), expect.objectContaining({ cleanupPending: true, keys: [published.cover_s3_key, published.thumbnail_s3_key] }));
        expect(deleteFromS3).not.toHaveBeenCalled();
      } finally { warning.mockRestore(); followup.reject = false; }
    });
  });

});
