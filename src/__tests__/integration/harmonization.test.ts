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
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
const url = process.env.DURTAL_HARMONIZATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln343_test"
  )
    throw new Error("Harmonization tests require disposable local sln343_test");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
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
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), CACHE_TAGS: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { redirectMergedRecord } from "@/lib/harmonization/redirect";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { loadSnapshot, loadDataset } from "@/lib/harmonization/store";
import {
  scanLibrary,
  applyFindingFixes,
  dismissFinding,
  restoreFinding,
  mergeRecords,
} from "@/lib/actions/harmonization";

describe.skipIf(!url)("Harmonization with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate works, authors, publishing_houses, locations, collections, series, recommenders, venues, places, custom_taxonomy_items, genres, sources, comments, activity_events, gallery_layouts, harmonization_decisions, harmonization_operations, harmonization_redirects cascade`,
    );
    await db.execute(sql`delete from taxonomy_families where not is_system`);
  });
  async function author(
    name: string,
    extra: Partial<typeof schema.authors.$inferInsert> = {},
  ) {
    return (
      await db
        .insert(schema.authors)
        .values({ name, ...extra })
        .returning()
    )[0];
  }
  async function work(
    title: string,
    extra: Partial<typeof schema.works.$inferInsert> = {},
  ) {
    return (
      await db
        .insert(schema.works)
        .values({ title, ...extra })
        .returning()
    )[0];
  }
  async function merge(
    entity: string,
    sourceId: string,
    targetId: string,
    choices: Record<string, "source" | "target"> = {},
  ) {
    const p = await previewMerge(entity, sourceId, targetId);
    return executeMerge({
      entity,
      sourceId,
      targetId,
      fingerprint: p.fingerprint,
      choices: {
        ...Object.fromEntries(
          p.fields.filter((f) => f.conflict).map((f) => [f.key, "target"]),
        ),
        ...choices,
      },
    });
  }
  async function count(table: string) {
    return Number(
      (await client!.unsafe(`select count(*) n from "${table}"`))[0].n,
    );
  }

  it("loads all registry entities and produces a real scan", async () => {
    await author(" Balle, Solvej ");
    const data = await loadDataset();
    expect(data.authors).toHaveLength(1);
    const result = await scanLibrary();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.persistenceAvailable).toBe(true);
      expect(
        result.value.findings.some((f) => f.rule === "name-whitespace"),
      ).toBe(true);
    }
  });
  it("merges author roles, media, comments, history and references atomically", async () => {
    const a = await author("Balle, Solvej", {
      bio: "Source biography",
      slug: "balle-solvej",
    });
    const b = await author("Solvej Balle", { slug: "solvej-balle" });
    const w = await work("On the Calculation of Volume");
    const [e] = await db
      .insert(schema.editions)
      .values({ workId: w.id, title: w.title })
      .returning();
    await db.insert(schema.workAuthors).values([
      { workId: w.id, authorId: a.id, role: "author" },
      { workId: w.id, authorId: b.id, role: "author" },
      { workId: w.id, authorId: a.id, role: "co_author" },
    ]);
    await db
      .insert(schema.editionContributors)
      .values({ editionId: e.id, authorId: a.id, role: "translator" });
    await db.insert(schema.media).values([
      { authorId: a.id, type: "poster", s3Key: "source.webp" },
      { authorId: b.id, type: "poster", s3Key: "target.webp" },
      { authorId: a.id, type: "gallery", s3Key: "gallery.webp" },
    ]);
    const [comment] = await db
      .insert(schema.comments)
      .values({
        entityType: "author",
        entityId: a.id,
        contentHtml: "<p>Keep this</p>",
      })
      .returning();
    await db.insert(schema.commentAttachments).values({
      commentId: comment.id,
      fileName: "notes.txt",
      fileSize: 2,
      mimeType: "text/plain",
      s3Key: "attachment.txt",
    });
    await db.insert(schema.activityEvents).values({
      entityType: "author",
      entityId: a.id,
      eventKey: "author.created",
    });
    await db
      .insert(schema.galleryLayouts)
      .values({ entityType: "author", entityId: a.id, layoutData: {} });
    const result = await merge("authors", a.id, b.id);
    expect(await count("authors")).toBe(1);
    expect(await count("work_authors")).toBe(2);
    expect(await count("edition_contributors")).toBe(1);
    const snapshot = await loadSnapshot("authors", [b.id]);
    expect(snapshot.data.records[0]).toMatchObject({
      name: "Solvej Balle",
      bio: "Source biography",
    });
    expect(snapshot.data.references.media).toHaveLength(3);
    expect(
      snapshot.data.references.media.filter(
        (m) => m.type === "poster" && m.is_active,
      ),
    ).toMatchObject([{ s3_key: "target.webp" }]);
    expect(snapshot.data.references.comments).toHaveLength(1);
    expect(await count("comment_attachments")).toBe(1);
    expect(snapshot.data.references.activity_events).toHaveLength(1);
    expect(await count("gallery_layouts")).toBe(0);
    const operation = (
      await client!`select * from harmonization_operations where id = ${result.operationId}`
    )[0];
    expect(operation.before.records).toHaveLength(2);
    expect(operation.after.records).toHaveLength(1);
    expect(
      (await client!`select * from harmonization_redirects`)[0],
    ).toMatchObject({ source_slug: "balle-solvej", target_id: b.id });
  });
  it("rejects a changed source and changed relationship snapshot", async () => {
    const a = await author("A"),
      b = await author("B");
    const p = await previewMerge("authors", a.id, b.id);
    await db
      .insert(schema.media)
      .values({ authorId: a.id, type: "gallery", s3Key: "new.webp" });
    await expect(
      executeMerge({
        entity: "authors",
        sourceId: a.id,
        targetId: b.id,
        fingerprint: p.fingerprint,
        choices: { name: "target" },
      }),
    ).rejects.toThrow("changed");
    expect(await count("authors")).toBe(2);
    expect(await count("harmonization_operations")).toBe(0);
  });
  it("serializes overlapping merges so only one stale request can succeed", async () => {
    const a = await author("A"),
      b = await author("B");
    const p = await previewMerge("authors", a.id, b.id);
    const input = {
      entity: "authors",
      sourceId: a.id,
      targetId: b.id,
      fingerprint: p.fingerprint,
      choices: { name: "target" as const },
    };
    const results = await Promise.allSettled([
      executeMerge(input),
      executeMerge(input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count("authors")).toBe(1);
    expect(await count("harmonization_operations")).toBe(1);
  });
  it("merges books while retaining editions, copies, collection membership, reader links and orders", async () => {
    const a = await work("Agua Viva", { notes: "Personal notes" }),
      b = await work("Água Viva");
    const [e] = await db
      .insert(schema.editions)
      .values({ workId: a.id, title: "Agua Viva", isbn13: "9780306406157" })
      .returning();
    const [l] = await db
      .insert(schema.locations)
      .values({ name: "Home", type: "physical" })
      .returning();
    const [i] = await db
      .insert(schema.instances)
      .values({ editionId: e.id, locationId: l.id })
      .returning();
    const [c] = await db
      .insert(schema.collections)
      .values({ name: "Favorites" })
      .returning();
    await db
      .insert(schema.collectionEditions)
      .values({ collectionId: c.id, editionId: e.id });
    await db.insert(schema.orders).values({
      workId: a.id,
      editionId: e.id,
      instanceId: i.id,
      acquisitionMethod: "gift",
      orderDate: "2026-01-01",
    });
    await db
      .insert(schema.calibreBooks)
      .values({ calibreId: 1, title: "Agua Viva", path: "book", workId: a.id });
    await db
      .insert(schema.workStatusHistory)
      .values({ workId: a.id, toStatus: "tracked" });
    await merge("works", a.id, b.id);
    expect(await count("works")).toBe(1);
    expect(await count("editions")).toBe(1);
    expect(await count("instances")).toBe(1);
    expect(await count("collection_editions")).toBe(1);
    expect((await client!`select * from editions`)[0].work_id).toBe(b.id);
    expect((await client!`select * from orders`)[0]).toMatchObject({
      work_id: b.id,
      edition_id: e.id,
      instance_id: i.id,
    });
    expect((await client!`select * from calibre_books`)[0].work_id).toBe(b.id);
    expect((await client!`select * from work_status_history`)[0].work_id).toBe(
      b.id,
    );
  });
  it("preserves edition-specific acquisition targets and fulfilment across a book merge", async () => {
    const a = await work("A"),
      b = await work("B");
    const [e] = await db
      .insert(schema.editions)
      .values({ workId: a.id, title: "A" })
      .returning();
    const [l] = await db
      .insert(schema.locations)
      .values({ name: "Home", type: "physical" })
      .returning();
    const [i] = await db
      .insert(schema.instances)
      .values({ editionId: e.id, locationId: l.id })
      .returning();
    const [t] = await db
      .insert(schema.acquisitionTargets)
      .values({ workId: a.id, editionId: e.id })
      .returning();
    await db
      .insert(schema.acquisitionTargetCopies)
      .values({ targetId: t.id, instanceId: i.id });
    await db.insert(schema.orders).values({
      workId: a.id,
      editionId: e.id,
      acquisitionTargetId: t.id,
      instanceId: i.id,
      acquisitionMethod: "gift",
      orderDate: "2026-01-01",
      status: "received",
    });
    await merge("works", a.id, b.id);
    expect((await client!`select * from acquisition_targets`)[0]).toMatchObject(
      { id: t.id, work_id: b.id, edition_id: e.id },
    );
    expect((await client!`select * from orders`)[0].work_id).toBe(b.id);
    expect(await count("acquisition_target_copies")).toBe(1);
  });
  it("preserves publisher aliases, imprints, editions and acquisition targets", async () => {
    const [a, b] = await db
      .insert(schema.publishingHouses)
      .values([
        { name: "Cafe Press", slug: "a" },
        { name: "Café Press", slug: "b" },
      ])
      .returning();
    const [imprint] = await db
      .insert(schema.publishingHouses)
      .values({
        name: "Imprint",
        slug: "imprint",
        kind: "imprint",
        parentId: a.id,
      })
      .returning();
    const w = await work("Book");
    const [e] = await db
      .insert(schema.editions)
      .values({ workId: w.id, title: "Book", publisher: "Cafe Press" })
      .returning();
    await db
      .insert(schema.editionPublishers)
      .values({ editionId: e.id, publisherId: imprint.id })
      .onConflictDoNothing();
    await db
      .insert(schema.acquisitionTargets)
      .values({ workId: w.id, publisherId: a.id });
    await merge("publishers", a.id, b.id);
    expect(
      (
        await client!`select * from publishing_houses where id = ${imprint.id}`
      )[0].parent_id,
    ).toBe(b.id);
    expect(
      (await client!`select * from acquisition_targets`)[0].publisher_id,
    ).toBe(b.id);
    expect((await client!`select * from publisher_aliases`)[0].name).toBe(
      "Cafe Press",
    );
    expect(
      (
        await client!`select * from edition_publishers where publisher_id = ${b.id}`
      ).length,
    ).toBe(1);
  });
  it("preserves taxonomy links and children, and keeps custom families separate", async () => {
    const [a, b] = await db
      .insert(schema.genres)
      .values([
        { name: "Cafe", slug: "a" },
        { name: "Café", slug: "b" },
      ])
      .returning();
    const [child] = await db
      .insert(schema.genres)
      .values({ name: "Child", slug: "child", parentId: a.id })
      .returning();
    const w = await work("Book");
    const [e] = await db
      .insert(schema.editions)
      .values({ workId: w.id, title: "Book" })
      .returning();
    await db.insert(schema.editionGenres).values([
      { editionId: e.id, genreId: a.id },
      { editionId: e.id, genreId: b.id },
    ]);
    await merge("genres", a.id, b.id);
    expect(
      (await client!`select * from genres where id = ${child.id}`)[0].parent_id,
    ).toBe(b.id);
    expect(await count("edition_genres")).toBe(1);
    const [f1, f2] = await db
      .insert(schema.taxonomyFamilies)
      .values([
        { name: "One", slug: "one" },
        { name: "Two", slug: "two" },
      ])
      .returning();
    const [c1, c2] = await db
      .insert(schema.customTaxonomyItems)
      .values([
        { familyId: f1.id, name: "Same", slug: "same" },
        { familyId: f2.id, name: "Same", slug: "same" },
      ])
      .returning();
    await expect(merge("custom-taxonomy", c1.id, c2.id)).rejects.toThrow(
      "different contexts",
    );
  });
  it("can retain the incoming unique value after removing the source", async () => {
    const [a, b] = await db
      .insert(schema.recommenders)
      .values([{ name: "Café" }, { name: "Cafe" }])
      .returning();
    await merge("recommenders", a.id, b.id, { name: "source" });
    expect((await client!`select * from recommenders`)[0].name).toBe("Café");
  });
  it("rolls all changes back if a late database trigger rejects the result", async () => {
    const a = await work("A"),
      b = await work("B");
    await db.insert(schema.editions).values({ workId: a.id, title: "A" });
    await client!`create function sln343_reject_update() returns trigger language plpgsql as $$ begin raise exception 'Test late rejection'; end $$`;
    await client!`create trigger sln343_reject_update before update on works for each row execute function sln343_reject_update()`;
    try {
      await expect(merge("works", a.id, b.id)).rejects.toThrow();
      expect(await count("works")).toBe(2);
      expect(await count("harmonization_operations")).toBe(0);
      expect(await count("harmonization_redirects")).toBe(0);
      expect((await client!`select * from editions`)[0].work_id).toBe(a.id);
    } finally {
      await client!`drop trigger sln343_reject_update on works`;
      await client!`drop function sln343_reject_update()`;
    }
  });
  it("fails closed on a future relationship the merge engine does not know", async () => {
    const a = await author("A"),
      b = await author("B");
    await client!`create table sln343_future_link (id uuid primary key default gen_random_uuid(), author_id uuid references authors(id) on delete cascade)`;
    try {
      await client!`insert into sln343_future_link (author_id) values (${a.id})`;
      await expect(merge("authors", a.id, b.id)).rejects.toThrow();
      expect(await count("authors")).toBe(2);
      expect(await count("sln343_future_link")).toBe(1);
    } finally {
      await client!`drop table sln343_future_link`;
    }
  });
  it("preserves cancelled target history and continues enforcing ordinary target identity guards", async () => {
    const a = await work("A"),
      b = await work("B");
    const [t] = await db
      .insert(schema.acquisitionTargets)
      .values({ workId: a.id })
      .returning();
    await db.insert(schema.orders).values({
      workId: a.id,
      acquisitionTargetId: t.id,
      acquisitionMethod: "gift",
      orderDate: "2026-01-01",
      status: "cancelled",
    });
    await client!`update acquisition_targets set is_cancelled = true where id = ${t.id}`;
    await expect(
      client!`update acquisition_targets set work_id = ${b.id} where id = ${t.id}`,
    ).rejects.toThrow("identity");
    await merge("works", a.id, b.id);
    expect((await client!`select * from orders`)[0]).toMatchObject({
      work_id: b.id,
      acquisition_target_id: t.id,
      status: "cancelled",
    });
    expect(
      (await client!`select * from acquisition_targets`)[0].is_cancelled,
    ).toBe(true);
  });
  it("moves locations with shelves, copies and acquisition destinations intact", async () => {
    const [a, b] = await db
      .insert(schema.locations)
      .values([
        { name: "Home", type: "physical" },
        { name: "House", type: "physical" },
      ])
      .returning();
    const [shelf] = await db
      .insert(schema.subLocations)
      .values({ name: "Shelf", locationId: a.id })
      .returning();
    const w = await work("Book");
    const [e] = await db
      .insert(schema.editions)
      .values({ workId: w.id, title: "Book" })
      .returning();
    await db
      .insert(schema.instances)
      .values({ editionId: e.id, locationId: a.id, subLocationId: shelf.id });
    await db.insert(schema.orders).values({
      workId: w.id,
      destinationLocationId: a.id,
      destinationSubLocationId: shelf.id,
      acquisitionMethod: "gift",
      orderDate: "2026-01-01",
    });
    await merge("locations", a.id, b.id);
    expect((await client!`select * from sub_locations`)[0].location_id).toBe(
      b.id,
    );
    expect((await client!`select * from instances`)[0]).toMatchObject({
      location_id: b.id,
      sub_location_id: shelf.id,
    });
    expect((await client!`select * from orders`)[0]).toMatchObject({
      destination_location_id: b.id,
      destination_sub_location_id: shelf.id,
    });
  });
  it("unions collections and moves series and recommender links", async () => {
    const w = await work("Book");
    const [e] = await db
      .insert(schema.editions)
      .values({ workId: w.id, title: "Book" })
      .returning();
    const [a, b] = await db
      .insert(schema.collections)
      .values([{ name: "A" }, { name: "B" }])
      .returning();
    await db.insert(schema.collectionEditions).values([
      { collectionId: a.id, editionId: e.id },
      { collectionId: b.id, editionId: e.id },
    ]);
    await merge("collections", a.id, b.id);
    expect(await count("collection_editions")).toBe(1);
    const [s1, s2] = await db
      .insert(schema.series)
      .values([
        { title: "A", slug: "a" },
        { title: "B", slug: "b" },
      ])
      .returning();
    await db.update(schema.works).set({ seriesId: s1.id });
    await merge("series", s1.id, s2.id);
    expect((await client!`select * from works`)[0].series_id).toBe(s2.id);
    const [r1, r2] = await db
      .insert(schema.recommenders)
      .values([{ name: "A" }, { name: "B" }])
      .returning();
    await db
      .insert(schema.workRecommenders)
      .values({ workId: w.id, recommenderId: r1.id });
    await merge("recommenders", r1.id, r2.id);
    expect(
      (await client!`select * from work_recommenders`)[0].recommender_id,
    ).toBe(r2.id);
  });
  it("redirects old bookmarks without capturing a newly reused live slug", async () => {
    const a = await author("A", { slug: "old-author" }),
      b = await author("B", { slug: "survivor" });
    await merge("authors", a.id, b.id);
    await expect(
      redirectMergedRecord("authors", "old-author"),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("/authors/survivor"),
    });
    await author("New author", { slug: "old-author" });
    await expect(
      redirectMergedRecord("authors", "old-author"),
    ).resolves.toBeUndefined();
  });
  it("shows readable names for differing foreign-key fields", async () => {
    const [p1, p2] = await db
      .insert(schema.places)
      .values([
        { name: "Paris", type: "city" },
        { name: "London", type: "city" },
      ])
      .returning();
    const a = await author("A", { birthPlaceId: p1.id }),
      b = await author("B", { birthPlaceId: p2.id });
    const preview = await previewMerge("authors", a.id, b.id);
    expect(
      preview.fields.find((f) => f.key === "birth_place_id")?.display,
    ).toEqual({ source: "Paris", target: "London" });
  });
  it("flattens redirect chains across repeated merges", async () => {
    const a = await author("A"),
      b = await author("B"),
      c = await author("C");
    await merge("authors", a.id, b.id);
    await merge("authors", b.id, c.id);
    expect(
      (await client!`select * from harmonization_redirects`).every(
        (r) => r.target_id === c.id,
      ),
    ).toBe(true);
  });
  it("persists dismissals, restores them, and resurfaces changed evidence", async () => {
    const a = await author("  Example  Name  ");
    const first = await scanLibrary();
    if (!first.ok) throw new Error(first.error);
    const f = first.value.findings.find((f) => f.rule === "name-whitespace")!;
    expect((await dismissFinding(f)).ok).toBe(true);
    // The inbox lists open findings; a dismissed one moves to its own view.
    const second = await scanLibrary({ view: "dismissed" });
    if (!second.ok) throw new Error(second.error);
    expect(
      second.value.findings.find((item) => item.key === f.key)?.dismissed,
    ).toBe(true);
    expect(second.value.counts.dismissed).toBe(1);
    const inbox = await scanLibrary();
    if (!inbox.ok) throw new Error(inbox.error);
    expect(inbox.value.findings.some((item) => item.key === f.key)).toBe(false);
    await restoreFinding(f);
    const third = await scanLibrary();
    if (!third.ok) throw new Error(third.error);
    expect(
      third.value.findings.find((item) => item.key === f.key)?.dismissed,
    ).toBe(false);
    await dismissFinding(f);
    await client!`update authors set name = ' Example   Name ' where id = ${a.id}`;
    const fourth = await scanLibrary();
    if (!fourth.ok) throw new Error(fourth.error);
    expect(
      fourth.value.findings.find((item) => item.key === f.key)?.dismissed,
    ).toBe(false);
  });
  it("applies server-derived fixes, rejects forged changes and audits the result", async () => {
    await author("Balle, Solvej");
    const result = await scanLibrary();
    if (!result.ok) throw new Error(result.error);
    const f = result.value.findings.find(
      (f) => f.rule === "author-display-name",
    )!;
    const fixed = await applyFindingFixes([
      {
        ...f,
        resolution: {
          kind: "update",
          changes: { name: "Malicious replacement" },
        },
      },
    ]);
    expect(fixed.ok && fixed.value.applied.length).toBe(1);
    expect((await client!`select * from authors`)[0]).toMatchObject({
      name: "Solvej Balle",
      sort_name: "Balle, Solvej",
    });
    expect(await count("harmonization_operations")).toBe(1);
    const replay = await applyFindingFixes([f]);
    expect(replay.ok && replay.value.failed.length).toBe(1);
  });
  it("reuses a stored edition cover as a work poster without altering the edition", async () => {
    const w = await work("Book");
    await db.insert(schema.editions).values({
      workId: w.id,
      title: "Book",
      coverS3Key: "cover.webp",
      thumbnailS3Key: "thumb.webp",
    });
    const result = await scanLibrary();
    if (!result.ok) throw new Error(result.error);
    const f = result.value.findings.find(
      (f) => f.entity === "works" && f.rule === "missing-artwork",
    )!;
    const fixed = await applyFindingFixes([f]);
    expect(fixed.ok && fixed.value.applied.length).toBe(1);
    expect((await client!`select * from media`)[0]).toMatchObject({
      work_id: w.id,
      type: "poster",
      s3_key: "cover.webp",
      is_active: true,
    });
    expect((await client!`select * from editions`)[0].cover_s3_key).toBe(
      "cover.webp",
    );
  });
  it("does not expose query text through invalid mutation responses", async () => {
    const result = await mergeRecords({
      entity: "authors",
      sourceId: "invalid",
      targetId: "invalid",
      fingerprint: "bad",
      choices: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).not.toMatch(/select|insert|params|SQL/);
  });
});
