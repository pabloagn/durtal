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

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_SIMILAR_WORKS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln327_test"
  )
    throw new Error("Similar works tests require disposable local sln327_test");
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
import { getSimilarWorks } from "@/lib/actions/similar-works";

describe.skipIf(!url)("similar works with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });

  const books: Record<string, { id: string; editions: string[] }> = {};
  const shelves: Record<string, string> = {};
  beforeEach(async () => {
    await db.execute(
      sql`truncate collections, works, authors, subjects, themes, literary_movements, series, recommenders, publishing_houses cascade`,
    );
    for (const [title, count] of [
      ["Target", 2],
      ["A", 2],
      ["B", 1],
      ["C", 1],
      ["D", 1],
      ["E", 1],
      ["X", 1],
    ] as const) {
      const [work] = await db
        .insert(schema.works)
        .values({ title })
        .returning();
      const eds = await db
        .insert(schema.editions)
        .values(
          Array.from({ length: count }, (_, i) => ({
            workId: work.id,
            title: `${title} ${i + 1}`,
          })),
        )
        .returning();
      books[title] = { id: work.id, editions: eds.map((e) => e.id) };
    }
    const [author] = await db
      .insert(schema.authors)
      .values({ name: "Author of C" })
      .returning();
    await db
      .insert(schema.workAuthors)
      .values({ workId: books.C.id, authorId: author.id });

    // Big (5 books) comes before Small (3 books); Other does not hold Target.
    for (const [name, sortOrder] of [
      ["Big", 0],
      ["Small", 1],
      ["Other", 2],
    ] as const) {
      const [c] = await db
        .insert(schema.collections)
        .values({ name, sortOrder })
        .returning();
      shelves[name] = c.id;
    }
    const members: [string, string][] = [
      ["Big", books.Target.editions[0]],
      ["Big", books.A.editions[0]],
      ["Big", books.A.editions[1]],
      ["Big", books.B.editions[0]],
      ["Big", books.C.editions[0]],
      ["Big", books.D.editions[0]],
      ["Small", books.Target.editions[1]],
      ["Small", books.C.editions[0]],
      ["Small", books.E.editions[0]],
      ["Other", books.X.editions[0]],
      ["Other", books.A.editions[0]],
    ];
    await db.insert(schema.collectionEditions).values(
      members.map(([name, editionId], sortOrder) => ({
        collectionId: shelves[name],
        editionId,
        sortOrder,
      })),
    );
  });

  const titles = async (title: string, limit?: number) =>
    (await getSimilarWorks(books[title].id, limit)).map((w) => w.title);

  it("ranks by shared collections, then the smaller collection, then collection order", async () => {
    // C shares both collections. E shares the small one. A, B, D share the big
    // one, in its member order. A has two editions there and counts once.
    // X is only in a collection Target is not in.
    expect(await titles("Target")).toEqual(["C", "E", "A", "B", "D"]);
    expect(await titles("Target", 2)).toEqual(["C", "E"]);
  });

  it("lists the strongest shared collections first", async () => {
    const [c, e] = await getSimilarWorks(books.Target.id);
    expect(c.reasons).toEqual([
      { kind: "collection", id: shelves.Small, name: "Small" },
      { kind: "collection", id: shelves.Big, name: "Big" },
    ]);
    expect(e.reasons.map((r) => r.name)).toEqual(["Small"]);
  });

  it("returns card data for each work", async () => {
    const [c] = await getSimilarWorks(books.Target.id);
    expect(c.workAuthors.map((wa) => wa.author.name)).toEqual(["Author of C"]);
    expect(c.editions).toHaveLength(1);
    expect(c.media).toEqual([]);
  });

  it("follows the collection's own order inside one collection", async () => {
    expect(await titles("E")).toEqual(["Target", "C"]);
    // A shares the two-book Other with X only, so X comes before the Big members.
    expect(await titles("A")).toEqual(["X", "Target", "B", "C", "D"]);
  });

  it("returns nothing for a book in no collection, or alone in one", async () => {
    await db
      .delete(schema.collectionEditions)
      .where(sql`collection_id = ${shelves.Other}::uuid`);
    await db.insert(schema.collectionEditions).values({
      collectionId: shelves.Other,
      editionId: books.X.editions[0],
    });
    expect(await titles("X")).toEqual([]);
    const [lonely] = await db
      .insert(schema.works)
      .values({ title: "Lonely" })
      .returning();
    expect(await getSimilarWorks(lonely.id)).toEqual([]);
  });

  type Kind =
    | "subject"
    | "theme"
    | "movement"
    | "series"
    | "recommender"
    | "author"
    | "translator"
    | "publisher";
  let sequence = 0;
  async function addSignal(
    kind: Kind,
    titles: string[],
    name = `Source ${++sequence}`,
  ) {
    const slug = `signal-${++sequence}`;
    let id: string;
    switch (kind) {
      case "subject": {
        const [source] = await db
          .insert(schema.subjects)
          .values({ name, slug })
          .returning();
        id = source.id;
        await db
          .insert(schema.workSubjects)
          .values(titles.map((t) => ({ workId: books[t].id, subjectId: id })));
        break;
      }
      case "theme": {
        const [source] = await db
          .insert(schema.themes)
          .values({ name, slug, level: 1 })
          .returning();
        id = source.id;
        await db
          .insert(schema.workThemes)
          .values(titles.map((t) => ({ workId: books[t].id, themeId: id })));
        break;
      }
      case "movement": {
        const [source] = await db
          .insert(schema.literaryMovements)
          .values({ name, slug, level: 1 })
          .returning();
        id = source.id;
        await db
          .insert(schema.workLiteraryMovements)
          .values(
            titles.map((t) => ({
              workId: books[t].id,
              literaryMovementId: id,
            })),
          );
        break;
      }
      case "series": {
        const [source] = await db
          .insert(schema.series)
          .values({ title: name, slug })
          .returning();
        id = source.id;
        for (const t of titles)
          await db
            .update(schema.works)
            .set({ seriesId: id })
            .where(sql`id = ${books[t].id}::uuid`);
        break;
      }
      case "recommender": {
        const [source] = await db
          .insert(schema.recommenders)
          .values({ name })
          .returning();
        id = source.id;
        await db
          .insert(schema.workRecommenders)
          .values(
            titles.map((t) => ({ workId: books[t].id, recommenderId: id })),
          );
        break;
      }
      case "author": {
        const [source] = await db
          .insert(schema.authors)
          .values({ name })
          .returning();
        id = source.id;
        await db
          .insert(schema.workAuthors)
          .values(
            titles.map((t) => ({
              workId: books[t].id,
              authorId: id,
              role: t === "Target" ? "co_author" : "author",
            })),
          );
        break;
      }
      case "translator": {
        const [source] = await db
          .insert(schema.authors)
          .values({ name })
          .returning();
        id = source.id;
        await db
          .insert(schema.editionContributors)
          .values(
            titles.flatMap((t) =>
              books[t].editions.map((editionId) => ({
                editionId,
                authorId: id,
                role: "translator",
              })),
            ),
          );
        break;
      }
      case "publisher": {
        const [source] = await db
          .insert(schema.publishingHouses)
          .values({ name, slug })
          .returning();
        id = source.id;
        await db
          .insert(schema.editionPublishers)
          .values(
            titles.flatMap((t) =>
              books[t].editions.map((editionId) => ({
                editionId,
                publisherId: id,
              })),
            ),
          );
        break;
      }
    }
    return { kind, id, name };
  }
  const kinds: Kind[] = [
    "subject",
    "theme",
    "movement",
    "series",
    "recommender",
    "author",
    "translator",
    "publisher",
  ];

  it.each(kinds)(
    "matches shared %s without collections and never matches itself",
    async (kind) => {
      await db.execute(sql`truncate collections cascade`);
      const reason = await addSignal(kind, ["Target", "A"]);
      const results = await getSimilarWorks(books.Target.id);
      expect(results.map((w) => w.title)).toEqual(["A"]);
      expect(results[0].reasons).toEqual([reason]);
      expect(await titles("X")).toEqual([]);
    },
  );

  it.each(kinds.filter((kind) => kind !== "series"))(
    "prefers a rarer %s source over a larger one",
    async (kind) => {
      await db.execute(sql`truncate collections cascade`);
      await addSignal(kind, ["Target", "A", "C", "D"], "Common");
      await addSignal(kind, ["Target", "B"], "Rare");
      expect(await titles("Target")).toEqual(["B", "A", "C", "D"]);
    },
  );

  it("counts distinct books in a series and applies its documented stronger weight", async () => {
    await db.execute(sql`truncate collections cascade`);
    await addSignal("series", ["Target", "A", "C", "D", "E"]); // 2/5
    await addSignal("subject", ["Target", "B"]); // 1/2
    expect(await titles("Target")).toEqual(["B", "A", "C", "D", "E"]);
    await addSignal("theme", ["Target", "A"]); // .4 + .5 beats .5
    expect((await titles("Target"))[0]).toBe("A");
  });

  it("sums evidence across kinds and orders reasons by their contribution", async () => {
    await db.execute(sql`truncate collections cascade`);
    const subject = await addSignal("subject", ["Target", "A"]); // .5
    const theme = await addSignal("theme", ["Target", "A"]); // .5
    const publisher = await addSignal("publisher", ["Target", "A"]); // .125
    await addSignal("series", ["Target", "B", "C"]); // .667
    const results = await getSimilarWorks(books.Target.id);
    expect(results.map((w) => w.title)).toEqual(["A", "B", "C"]);
    expect(results[0].reasons).toEqual([subject, theme, publisher]);
  });

  it("ranks total rarity before source count", async () => {
    await db.execute(sql`truncate collections cascade`);
    await addSignal("subject", ["Target", "A", "C", "D", "E", "X"]); // 1/6
    await addSignal("theme", ["Target", "A", "C", "D", "E", "X"]); // 1/6
    await addSignal("author", ["Target", "B"]); // 1/2
    expect((await titles("Target"))[0]).toBe("B");
  });

  it("deduplicates work/edition collection membership and author credit roles", async () => {
    await db
      .insert(schema.collectionWorks)
      .values({ collectionId: shelves.Big, workId: books.A.id });
    const reason = await addSignal("author", ["Target", "A"]);
    await db
      .insert(schema.workAuthors)
      .values({ workId: books.A.id, authorId: reason.id, role: "co_author" });
    const results = await getSimilarWorks(books.Target.id);
    expect(results[0].title).toBe("A");
    expect(results[0].reasons.filter((r) => r.kind === "author")).toEqual([
      reason,
    ]);
    expect(
      results[0].reasons.filter((r) => r.kind === "collection"),
    ).toHaveLength(1);
  });

  it("keeps score and reasons identical when another edition repeats translator/publisher links", async () => {
    await db.execute(sql`truncate collections cascade`);
    for (const kind of ["translator", "publisher"] as const) {
      const reason = await addSignal(kind, ["Target", "A", "B"]);
      const results = await getSimilarWorks(books.Target.id);
      expect(results.map((w) => w.title)).toEqual(["A", "B"]);
      expect(results[0].reasons.filter((r) => r.kind === kind)).toEqual([
        reason,
      ]);
      expect(results[1].reasons.filter((r) => r.kind === kind)).toEqual([
        reason,
      ]);
    }
  });

  it("does not confuse translators with authors/editors or guess publishers from text", async () => {
    await db.execute(sql`truncate collections cascade`);
    const reason = await addSignal("translator", ["Target"]);
    await db
      .insert(schema.workAuthors)
      .values({ workId: books.A.id, authorId: reason.id });
    await db
      .insert(schema.editionContributors)
      .values({
        editionId: books.B.editions[0],
        authorId: reason.id,
        role: "editor",
      });
    for (const t of ["Target", "A"])
      await db
        .update(schema.editions)
        .set({ publisher: "Unresolved text" })
        .where(sql`work_id = ${books[t].id}::uuid`);
    expect(await titles("Target")).toEqual([]);
  });

  it("breaks non-collection ties by title then UUID, deterministically", async () => {
    await db.execute(sql`truncate collections cascade`);
    await addSignal("subject", ["Target", "B", "A"]);
    expect(await titles("Target")).toEqual(["A", "B"]);
    await db
      .update(schema.works)
      .set({ title: "Same" })
      .where(sql`id in (${books.A.id}::uuid, ${books.B.id}::uuid)`);
    const expected = [books.A.id, books.B.id].sort();
    expect((await getSimilarWorks(books.Target.id)).map((w) => w.id)).toEqual(
      expected,
    );
    expect((await getSimilarWorks(books.Target.id)).map((w) => w.id)).toEqual(
      expected,
    );
  });

  it("excludes other work kinds from candidates, rarity counts and targets", async () => {
    const [film] = await db
      .insert(schema.works)
      .values({ title: "Film", kind: "film", originalLanguage: null })
      .returning();
    books.Film = { id: film.id, editions: [] };
    await db.execute(sql`truncate collections cascade`);
    const subject = await addSignal("subject", ["Target", "A", "Film"]);
    await addSignal("theme", ["Target", "B"]);
    await addSignal("movement", ["Target", "Film"]);
    await addSignal("recommender", ["Target", "Film"]);
    const results = await getSimilarWorks(books.Target.id);
    expect(results.map((w) => w.title)).toEqual(["A", "B"]); // both 1/2; the film does not dilute subject
    expect(results[0].reasons).toEqual([subject]);
    expect(await getSimilarWorks(film.id)).toEqual([]);
    const [collection] = await db
      .insert(schema.collections)
      .values({ name: "Mixed" })
      .returning();
    await db
      .insert(schema.collectionWorks)
      .values(
        ["Target", "A", "Film"].map((t) => ({
          workId: books[t].id,
          collectionId: collection.id,
        })),
      );
    expect(
      (await getSimilarWorks(books.Target.id)).map((w) => w.title),
    ).toEqual(["A", "B"]);
  });

  it("rejects a bad id or limit", async () => {
    await expect(getSimilarWorks("nope")).rejects.toThrow();
    await expect(getSimilarWorks(books.Target.id, 0)).rejects.toThrow();
    await expect(getSimilarWorks(books.Target.id, 51)).rejects.toThrow();
    await expect(getSimilarWorks(books.Target.id, 1.5)).rejects.toThrow();
  });
});
