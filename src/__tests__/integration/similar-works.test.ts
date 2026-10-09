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
import type { WorkKind } from "@/lib/catalogue/kinds";

// Explicit local opt-in only: never read a live environment or database URL.
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
import { getBookRelatedGroups } from "@/lib/actions/book-related";
import { getWorksByAuthorId, getWorksWithMark } from "@/lib/actions/works";
import { getCollectionsForWork } from "@/lib/actions/collections";

describe.skipIf(!url)(
  "semantic similarity and independent related sections with PostgreSQL",
  () => {
    const db = testDb!;
    beforeAll(async () => {
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
    });
    afterAll(async () => {
      await client?.end();
    });
    beforeEach(async () => {
      await db.execute(
        sql`truncate works, authors, subjects, themes, keywords, literary_movements, art_movements, collections, publishing_houses, series, recommenders cascade`,
      );
    });

    async function work(
      title: string,
      kind: WorkKind = "book",
      originalYear: number | null = null,
    ) {
      const [row] = await db
        .insert(schema.works)
        .values({
          title,
          slug: `${kind}-${crypto.randomUUID()}`,
          kind,
          originalLanguage: kind === "book" ? "en" : null,
          originalYear,
        })
        .returning();
      if (kind === "film")
        await db.insert(schema.filmDetails).values({ workId: row.id });
      if (kind === "perfume")
        await db.insert(schema.perfumeDetails).values({ workId: row.id });
      if (kind === "painting")
        await db.insert(schema.paintingDetails).values({ workId: row.id });
      return row;
    }
    async function edition(
      workId: string,
      title = "Chosen edition",
      year = 1998,
      createdAt = new Date("2020-01-01"),
    ) {
      const [row] = await db
        .insert(schema.editions)
        .values({
          workId,
          title,
          publicationYear: year,
          coverS3Key: `${title}.webp`,
          publisherLinksConfirmed: true,
          createdAt,
        })
        .returning();
      return row;
    }
    async function subject(name: string, ids: string[]) {
      const [item] = await db
        .insert(schema.subjects)
        .values({ name, slug: crypto.randomUUID() })
        .returning();
      await db
        .insert(schema.workSubjects)
        .values(ids.map((workId) => ({ workId, subjectId: item.id })));
      return item;
    }
    async function theme(
      name: string,
      ids: string[],
      parentId: string | null = null,
      level = 1,
    ) {
      const [item] = await db
        .insert(schema.themes)
        .values({ name, slug: crypto.randomUUID(), parentId, level })
        .returning();
      await db
        .insert(schema.workThemes)
        .values(ids.map((workId) => ({ workId, themeId: item.id })));
      return item;
    }
    async function keyword(name: string, ids: string[]) {
      const [item] = await db
        .insert(schema.keywords)
        .values({ name, slug: crypto.randomUUID() })
        .returning();
      await db
        .insert(schema.workKeywords)
        .values(ids.map((workId) => ({ workId, keywordId: item.id })));
    }
    async function person(name: string) {
      const [row] = await db
        .insert(schema.authors)
        .values({ name, slug: crypto.randomUUID() })
        .returning();
      return row;
    }
    async function house(
      name: string,
      kind: "publisher" | "imprint" = "publisher",
      parentId: string | null = null,
    ) {
      const [row] = await db
        .insert(schema.publishingHouses)
        .values({ name, slug: crypto.randomUUID(), kind, parentId })
        .returning();
      return row;
    }
    const ids = async (id: string, limit?: number) =>
      (await getSimilarWorks(id, limit)).map((row) => row.id);

    it("returns all four kinds only with comparable content and their own routes, creators and dates", async () => {
      const target = await work("Target", "book", 1982);
      const matches = await Promise.all([
        work("Book", "book", 1982),
        work("Film", "film"),
        work("Perfume", "perfume"),
        work("Painting", "painting"),
      ]);
      await subject("Alienation", [target.id, ...matches.map((row) => row.id)]);
      await keyword("Urban solitude", [
        target.id,
        ...matches.map((row) => row.id),
      ]);
      const author = await person("Correct director");
      await db.insert(schema.workCredits).values({
        workId: matches[1].id,
        personId: author.id,
        roleId: "film.director",
      });
      const [date] = await db
        .insert(schema.catalogueDates)
        .values({ precision: "year", startYear: 1982 })
        .returning();
      await db
        .update(schema.filmDetails)
        .set({ releaseDateId: date.id })
        .where(eq(schema.filmDetails.workId, matches[1].id));
      const otherDates = await db
        .insert(schema.catalogueDates)
        .values([
          { precision: "year", startYear: 1982 },
          { precision: "year", startYear: 1982 },
        ])
        .returning();
      await db
        .update(schema.perfumeDetails)
        .set({ releaseDateId: otherDates[0].id })
        .where(eq(schema.perfumeDetails.workId, matches[2].id));
      await db
        .update(schema.paintingDetails)
        .set({ creationDateId: otherDates[1].id })
        .where(eq(schema.paintingDetails.workId, matches[3].id));
      const perfumer = await person("Correct perfumer"),
        painter = await person("Correct painter"),
        actor = await person("Actor only");
      await db.insert(schema.workCredits).values([
        {
          workId: matches[2].id,
          personId: perfumer.id,
          roleId: "perfume.perfumer",
        },
        {
          workId: matches[3].id,
          personId: painter.id,
          roleId: "painting.painter",
        },
        { workId: matches[1].id, personId: actor.id, roleId: "film.cast" },
      ]);
      const results = await getSimilarWorks(target.id);
      expect(new Set(results.map((row) => row.kind))).toEqual(
        new Set(["book", "film", "perfume", "painting"]),
      );
      for (const result of results) {
        expect(result).not.toHaveProperty("reasons");
        if (result.kind !== "book")
          expect(result.tile.href).toBe(
            `/${result.kind === "painting" ? "paintings" : result.kind === "film" ? "films" : "perfumes"}/${matches.find((row) => row.id === result.id)!.slug}`,
          );
      }
      const film = results.find((row) => row.kind === "film")!;
      if (film.kind !== "book") {
        expect(film.tile.creators).toBe("Correct director");
        expect(film.tile.date).toBe("1982");
      }
      for (const result of results)
        if (result.kind === "perfume" || result.kind === "painting") {
          expect(result.tile.creators).toBe(
            result.kind === "perfume" ? "Correct perfumer" : "Correct painter",
          );
          expect(result.tile.date).toBe("1982");
        }
      expect(await ids(matches[1].id)).toContain(target.id); // The action itself has no book-only source gate.
      expect(results.map((row) => row.id)).not.toContain(target.id);
    });

    it("does not match collection, author, translator, publisher, year, series, recommender or status alone", async () => {
      const target = await work("Target", "book", 1980),
        negative = await work("Negative", "book", 1980);
      const a = await person("Shared creator"),
        p = await house("Shared house");
      const eds = [await edition(target.id), await edition(negative.id)];
      await db
        .insert(schema.workAuthors)
        .values(
          [target, negative].map((row) => ({ workId: row.id, authorId: a.id })),
        );
      await db.insert(schema.editionContributors).values(
        eds.map((row) => ({
          editionId: row.id,
          authorId: a.id,
          role: "translator",
        })),
      );
      await db
        .insert(schema.editionPublishers)
        .values(eds.map((row) => ({ editionId: row.id, publisherId: p.id })));
      const [c] = await db
        .insert(schema.collections)
        .values({ name: "Shared shelf" })
        .returning();
      await db
        .insert(schema.collectionEditions)
        .values(eds.map((row) => ({ collectionId: c.id, editionId: row.id })));
      const [series] = await db
        .insert(schema.series)
        .values({ title: "Same series", slug: "same-series" })
        .returning();
      await db
        .update(schema.works)
        .set({
          seriesId: series.id,
          isRare: true,
          huntAssessedOn: "2026-10-09",
          isPoison: true,
        })
        .where(sql`id in (${target.id},${negative.id})`);
      const [r] = await db
        .insert(schema.recommenders)
        .values({ name: "Same recommender" })
        .returning();
      await db.insert(schema.workRecommenders).values(
        [target, negative].map((row) => ({
          workId: row.id,
          recommenderId: r.id,
        })),
      );
      expect(await ids(target.id)).toEqual([]);
      expect(
        (await getBookRelatedGroups(target.id)).map((group) => group.kind),
      ).toEqual(["author", "translator", "publisher"]);
      expect(
        (await getWorksWithMark("rare", target.id)).map((row) => row.id),
      ).toEqual([negative.id]);
      expect(
        (await getWorksWithMark("poison", target.id)).map((row) => row.id),
      ).toEqual([negative.id]);
      expect(
        (await getCollectionsForWork(target.id)).map((row) => row.name),
      ).toEqual(["Shared shelf"]);
    });

    it("leaves empty and single-item metadata empty, and never equates names across vocabularies", async () => {
      const target = await work("Target"),
        sparse = await work("Sparse"),
        unrelated = await work("Unrelated", "perfume");
      expect(await ids(target.id)).toEqual([]);
      await subject("Rose", [target.id, sparse.id]);
      await keyword("Grief", [target.id]);
      await subject("Grief", [unrelated.id]);
      await keyword("Rose", [unrelated.id]);
      expect(await ids(target.id)).toEqual([]);
      const [family] = await db
        .select()
        .from(schema.taxonomyFamilies)
        .where(eq(schema.taxonomyFamilies.slug, "perfume-notes"));
      const [item] = await db
        .insert(schema.customTaxonomyItems)
        .values({ familyId: family.id, name: "Rose", slug: "rose" })
        .returning();
      await db
        .insert(schema.perfumeNotes)
        .values({ workId: unrelated.id, itemId: item.id });
      expect(await ids(target.id)).toEqual([]);
      expect(await getBookRelatedGroups(target.id)).toEqual([]);
    });

    it("collapses an entire shared hierarchy chain but retains independent sibling items without inferring them", async () => {
      const target = await work("Target"),
        chain = await work("Chain"),
        parentOnly = await work("Parent only"),
        sibling = await work("Sibling");
      const root = await theme("Loss", [target.id, chain.id, parentOnly.id]);
      const child = await theme("Grief", [target.id, chain.id], root.id, 2);
      await theme("Bereavement", [target.id, chain.id], child.id, 3);
      expect(await ids(target.id)).toEqual([]);
      await theme("Estrangement", [target.id, sibling.id], root.id, 2);
      await subject("Exile", [target.id, sibling.id]);
      expect(await ids(target.id)).toEqual([sibling.id]);
    });

    it("supports comparable art movements without treating literary and art movement names as equal", async () => {
      const target = await work("Target"),
        painting = await work("Painting", "painting"),
        book = await work("Book");
      const [art] = await db
        .insert(schema.artMovements)
        .values({ name: "Symbolism", slug: "symbolism" })
        .returning();
      const [literary] = await db
        .insert(schema.literaryMovements)
        .values({ name: "Symbolism", slug: "symbolism", level: 1 })
        .returning();
      await db.insert(schema.workArtMovements).values(
        [target, painting].map((row) => ({
          workId: row.id,
          artMovementId: art.id,
        })),
      );
      await db
        .insert(schema.workLiteraryMovements)
        .values({ workId: book.id, literaryMovementId: literary.id });
      await keyword("Dream", [target.id, painting.id, book.id]);
      expect(await ids(target.id)).toEqual([painting.id]);
    });

    it("weights distinct enabled works by frequency and retains deterministic title/UUID ties and limits", async () => {
      const target = await work("Target"),
        rare = await work("Z specific"),
        common = await work("A common");
      const others = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          work(`Filler ${i}`, i % 2 ? "perfume" : "film"),
        ),
      );
      const broad = [target.id, common.id, ...others.map((row) => row.id)];
      await subject("Memory", broad);
      await keyword("Childhood", broad);
      await theme("Ritual grief", [target.id, rare.id]);
      await keyword("Funeral rite", [target.id, rare.id]);
      expect(await ids(target.id, 1)).toEqual([rare.id]);
      const a = await work("Same"),
        b = await work("Same");
      await theme("Ritual grief 2", [target.id, a.id, b.id]);
      await keyword("Funeral rite 2", [target.id, a.id, b.id]);
      const ordered = await ids(target.id);
      expect(ordered.filter((id) => id === a.id || id === b.id)).toEqual(
        [a.id, b.id].sort(),
      );
      expect(await ids(target.id)).toEqual(ordered);
      expect(await ids(target.id, 2)).toEqual(ordered.slice(0, 2));
    });

    it("caps prolific families and keeps year proximity weaker than stronger semantic evidence", async () => {
      const target = await work("Target", "book", 1980),
        prolific = await work("A same year", "book", 1980),
        diverse = await work("Z stronger content", "book", 1880);
      for (let i = 0; i < 12; i++)
        await subject(`Shared content ${i}`, [target.id, prolific.id]);
      await theme("Identity", [target.id, diverse.id]);
      await keyword("Metamorphosis", [target.id, diverse.id]);
      const [movement] = await db
        .insert(schema.artMovements)
        .values({ name: "Surrealism", slug: "surrealism" })
        .returning();
      await db.insert(schema.workArtMovements).values(
        [target, diverse].map((row) => ({
          workId: row.id,
          artMovementId: movement.id,
        })),
      );
      expect(await ids(target.id)).toEqual([diverse.id, prolific.id]);
    });

    it("collection additions, duplicate edition/work membership and order changes cannot change similarity", async () => {
      const target = await work("Target"),
        a = await work("A"),
        b = await work("B"),
        unrelated = await work("Unrelated");
      await subject("Exile", [target.id, a.id, b.id]);
      await keyword("Migration", [target.id, a.id, b.id]);
      const before = await ids(target.id);
      const [c] = await db
        .insert(schema.collections)
        .values({ name: "Shelf" })
        .returning();
      const eds = [
        await edition(target.id),
        await edition(a.id),
        await edition(a.id, "Second"),
        await edition(unrelated.id),
      ];
      await db.insert(schema.collectionEditions).values(
        eds.map((row, sortOrder) => ({
          collectionId: c.id,
          editionId: row.id,
          sortOrder,
        })),
      );
      await db.insert(schema.collectionWorks).values(
        [target, a, unrelated].map((row) => ({
          collectionId: c.id,
          workId: row.id,
        })),
      );
      expect(await ids(target.id)).toEqual(before);
      await db.update(schema.collectionEditions).set({ sortOrder: 99 });
      await db
        .update(schema.collections)
        .set({ name: "Changed", sortOrder: -2 });
      expect(await ids(target.id)).toEqual(before);
      await db.delete(schema.collections);
      expect(await ids(target.id)).toEqual(before);
    });

    it("uses original book years instead of reprint years and ignores unknown, approximate and range domain dates", async () => {
      const target = await work("Target", "book", 1980),
        far = await work("A far", "book", 1900),
        near = await work("Z near", "book", 1980),
        film = await work("B film", "film", 1980);
      await edition(far.id, "1980 reprint", 1980);
      await edition(near.id, "1900 error", 1900);
      await subject("Ritual", [target.id, far.id, near.id, film.id]);
      await keyword("Death", [target.id, far.id, near.id, film.id]);
      expect((await ids(target.id))[0]).toBe(near.id);
      // Film's compatibility originalYear never substitutes for its domain date.
      expect((await ids(target.id)).indexOf(far.id)).toBeLessThan(
        (await ids(target.id)).indexOf(film.id),
      );
      const [date] = await db
        .insert(schema.catalogueDates)
        .values({ precision: "range", startYear: 1979, endYear: 1981 })
        .returning();
      await db
        .update(schema.filmDetails)
        .set({ releaseDateId: date.id })
        .where(eq(schema.filmDetails.workId, film.id));
      const noBoost = await ids(target.id);
      const [approximate] = await db
        .insert(schema.catalogueDates)
        .values({ precision: "year", startYear: 1980, approximate: true })
        .returning();
      await db
        .update(schema.filmDetails)
        .set({ releaseDateId: approximate.id })
        .where(eq(schema.filmDetails.workId, film.id));
      expect(await ids(target.id)).toEqual(noBoost);
      const [exact] = await db
        .insert(schema.catalogueDates)
        .values({ precision: "year", startYear: 1980 })
        .returning();
      await db
        .update(schema.filmDetails)
        .set({ releaseDateId: exact.id })
        .where(eq(schema.filmDetails.workId, film.id));
      expect((await ids(target.id))[0]).toBe(film.id); // Equal proximity, alphabetical tie.
    });

    it("keeps every author/coauthor and translator group independent, deduplicated, and tied to a matching edition", async () => {
      const target = await work("Target"),
        authored = await work("Authored"),
        translated = await work("Translated"),
        wrong = await work("Wrong role");
      const a = await person("Alice"),
        b = await person("Bob"),
        editor = await person("Editor only");
      await db
        .insert(schema.creditRoles)
        .values({
          id: "book.test.compiler",
          kind: "book",
          level: "work",
          label: "Compiler",
          legacyRole: "compiler",
        })
        .onConflictDoNothing();
      await db.insert(schema.workAuthors).values([
        { workId: target.id, authorId: a.id },
        { workId: target.id, authorId: a.id, role: "co_author" },
        { workId: target.id, authorId: b.id, role: "co_author", sortOrder: 1 },
        { workId: authored.id, authorId: a.id },
        { workId: authored.id, authorId: b.id, role: "co_author" },
        { workId: wrong.id, authorId: a.id, role: "compiler" },
      ]);
      const targetEds = [
        await edition(target.id),
        await edition(target.id, "Target two"),
      ];
      const unrelatedCover = await edition(
        translated.id,
        "Unrelated cover",
        2000,
        new Date("1990-01-01"),
      );
      const matching = await edition(
        translated.id,
        "The translated edition",
        1998,
        new Date("2000-01-01"),
      );
      const later = await edition(
        translated.id,
        "Later translated edition",
        2020,
        new Date("2020-01-01"),
      );
      const wrongEd = await edition(wrong.id);
      await db.insert(schema.editionContributors).values([
        ...targetEds.flatMap((ed) => [
          { editionId: ed.id, authorId: a.id, role: "translator" },
          {
            editionId: ed.id,
            authorId: b.id,
            role: "translator",
            sortOrder: 1,
          },
        ]),
        { editionId: targetEds[0].id, authorId: editor.id, role: "editor" },
        ...[matching, later].flatMap((ed) => [
          { editionId: ed.id, authorId: a.id, role: "translator" },
          { editionId: ed.id, authorId: b.id, role: "translator" },
        ]),
        { editionId: wrongEd.id, authorId: a.id, role: "editor" },
      ]);
      const groups = await getBookRelatedGroups(target.id, 1);
      expect(groups.map((group) => `${group.kind}:${group.name}`)).toEqual([
        "author:Alice",
        "author:Bob",
        "translator:Alice",
        "translator:Bob",
      ]);
      for (const group of groups) {
        expect(group.works.map((row) => row.id)).toEqual([
          group.kind === "author" ? authored.id : translated.id,
        ]);
        if (group.kind === "translator") {
          expect(group.works[0].editions[0].id).toBe(matching.id);
          expect(group.works[0].editions[0].coverS3Key).not.toBe(
            unrelatedCover.coverS3Key,
          );
          expect(group.works[0].media).toEqual([]);
          expect(group.works[0].editionNote).toContain(
            `Translated by ${group.name}`,
          );
        }
      }
      expect(
        (await getWorksByAuthorId(a.id)).map((row) => row.id),
      ).not.toContain(wrong.id);
    });

    it("uses canonical co-publishing identities and descendant-only publisher families with matching covers", async () => {
      const target = await work("Target"),
        childBook = await work("Child"),
        siblingBook = await work("Sibling"),
        coBook = await work("Co-published"),
        sameName = await work("Same name wrong identity");
      const parent = await house("Parent"),
        imprint = await house("Imprint", "imprint", parent.id),
        sibling = await house("Sibling imprint", "imprint", parent.id),
        co = await house("Co-publisher"),
        unrelated = await house("Imprint");
      const targetEd = await edition(target.id),
        childEd = await edition(childBook.id, "Child imprint edition"),
        siblingEd = await edition(siblingBook.id),
        coEd = await edition(coBook.id),
        sameEd = await edition(sameName.id);
      await edition(
        childBook.id,
        "Unrelated preferred cover",
        2000,
        new Date("1990-01-01"),
      );
      await db.insert(schema.editionPublishers).values([
        { editionId: targetEd.id, publisherId: imprint.id },
        { editionId: targetEd.id, publisherId: co.id },
        { editionId: childEd.id, publisherId: imprint.id },
        { editionId: siblingEd.id, publisherId: sibling.id },
        { editionId: coEd.id, publisherId: co.id },
        { editionId: sameEd.id, publisherId: unrelated.id },
      ]);
      let groups = await getBookRelatedGroups(target.id);
      expect(groups.map((group) => group.id).sort()).toEqual(
        [imprint.id, co.id].sort(),
      );
      const row = groups.find((group) => group.id === imprint.id)!;
      expect(row.works.map((book) => book.id)).toEqual([childBook.id]);
      expect(row.works[0].editions[0].id).toBe(childEd.id);
      expect(row.works[0].editionNote).toContain("Published by Imprint");
      await db
        .insert(schema.editionPublishers)
        .values({ editionId: targetEd.id, publisherId: parent.id });
      groups = await getBookRelatedGroups(target.id);
      expect(
        groups
          .find((group) => group.id === parent.id)!
          .works.map((book) => book.id),
      ).toEqual([childBook.id, siblingBook.id]);
    });

    it("omits each empty contributor/publishing group independently, even with source associations present", async () => {
      const target = await work("Target"),
        a = await person("Author"),
        t = await person("Translator"),
        p = await house("House");
      const ed = await edition(target.id);
      await db
        .insert(schema.workAuthors)
        .values({ workId: target.id, authorId: a.id });
      await db
        .insert(schema.editionContributors)
        .values({ editionId: ed.id, authorId: t.id, role: "translator" });
      await db
        .insert(schema.editionPublishers)
        .values({ editionId: ed.id, publisherId: p.id });
      expect(await getBookRelatedGroups(target.id)).toEqual([]);
      const other = await work("Other by author");
      await db
        .insert(schema.workAuthors)
        .values({ workId: other.id, authorId: a.id });
      const groups = await getBookRelatedGroups(target.id);
      expect(groups.map((group) => group.kind)).toEqual(["author"]);
      expect(groups[0].works.map((book) => book.id)).toEqual([other.id]);
    });

    it("rejects malformed IDs and unbounded/fractional limits for both loaders", async () => {
      const target = await work("Target");
      for (const load of [getSimilarWorks, getBookRelatedGroups]) {
        await expect(load("nope")).rejects.toThrow();
        for (const limit of [0, 51, 1.5])
          await expect(load(target.id, limit)).rejects.toThrow();
      }
    });
  },
);
