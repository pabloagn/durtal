import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import { DOMAIN_TAXONOMIES } from "@/lib/catalogue/taxonomies";
const url = process.env.DURTAL_TAXONOMY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln352_test"
  )
    throw new Error("Taxonomy tests require disposable local sln352_test");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local database required");
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
import {
  getApplicableTaxonomyFamilies,
  getTaxonomyFamily,
  getTaxonomyFamilies,
  createTaxonomyFamily,
  updateTaxonomyFamily,
  deleteTaxonomyFamily,
  setTaxonomyApplicability,
  createTaxonomyItem,
  updateTaxonomyItem,
  deleteTaxonomyItem,
  mergeTaxonomyItems,
  moveTaxonomyItem,
  reorderTaxonomyItems,
  getTaxonomyItems,
  replaceTaxonomyAssignments,
} from "@/lib/actions/taxonomy-families";
import { updateWorkTaxonomy } from "@/lib/actions/taxonomy";

describe.skipIf(!url)("domain and level-aware taxonomy", () => {
  const c = client!;
  let work: Record<string, string>, editionId: string;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works,subjects,genres,tags,themes,book_categories,art_types,custom_taxonomy_items,harmonization_operations,harmonization_redirects cascade`;
    await c`delete from taxonomy_families where not is_system`;
    const rows =
      await c`insert into works(title,slug,kind,original_language) values ('Book','book','book','en'),('Film','film','film',null),('Perfume','perfume','perfume',null),('Painting','painting','painting',null) returning id,kind`;
    work = Object.fromEntries(rows.map((r) => [r.kind, r.id]));
    const [edition] =
      await c`insert into editions(work_id,title) values (${work.book},'Edition') returning id`;
    editionId = edition.id;
  });
  it("seeds distinct vocabularies and shares only intentional work families", async () => {
    for (const definition of DOMAIN_TAXONOMIES) {
      const family = await getTaxonomyFamily(definition.slug);
      expect(family?.isSystem).toBe(true);
      expect(
        family?.applicability.map((a) => [a.kind, a.level]).sort(),
      ).toEqual(
        definition.levels.map((level) => [definition.kind, level]).sort(),
      );
    }
    const film = (await getApplicableTaxonomyFamilies("film")).map(
      (r) => r.family.slug,
    );
    expect(film.sort()).toEqual([
      "film-genres",
      "keywords",
      "subjects",
      "themes",
    ]);
    expect(
      (await getApplicableTaxonomyFamilies("painting")).map(
        (r) => r.family.slug,
      ),
    ).toContain("art-movements");
    expect(
      (await getApplicableTaxonomyFamilies("book", "edition"))
        .map((r) => r.family.slug)
        .sort(),
    ).toEqual(["genres", "tags"]);
    expect(
      (await getTaxonomyFamilies()).some((f) => f.slug === "film-genres"),
    ).toBe(false);
    await expect(
      getApplicableTaxonomyFamilies("book", "film_version"),
    ).rejects.toThrow();
  });
  it("enforces domain and level assignment through services and direct SQL", async () => {
    const genre = await createTaxonomyItem("film-genres", { name: "Drama" });
    await replaceTaxonomyAssignments({
      familySlug: "film-genres",
      kind: "film",
      level: "work",
      ownerId: work.film,
      itemIds: [genre.id],
    });
    await expect(
      replaceTaxonomyAssignments({
        familySlug: "film-genres",
        kind: "book",
        level: "work",
        ownerId: work.book,
        itemIds: [genre.id],
      }),
    ).rejects.toThrow();
    await expect(
      c`insert into custom_taxonomy_item_editions(item_id,edition_id) values (${genre.id},${editionId})`,
    ).rejects.toMatchObject({ constraint_name: "taxonomy_assignment_scope" });
    const category = await createTaxonomyItem("categories", {
      name: "Literature",
    });
    await expect(
      c`insert into work_categories(work_id,category_id) values (${work.film},${category.id})`,
    ).rejects.toMatchObject({ constraint_name: "taxonomy_assignment_scope" });
    const art = await createTaxonomyItem("art-types", { name: "Painting" });
    await c`insert into work_art_types(work_id,art_type_id) values (${work.book},${art.id}),(${work.painting},${art.id})`;
    expect(await c`select * from work_art_types`).toHaveLength(2);
  });
  it("preserves old assignments while changing custom scopes and blocks removal of used scopes", async () => {
    const family = await createTaxonomyFamily({ name: "Mood", slug: "mood" });
    const item = await createTaxonomyItem("mood", { name: "Dark" });
    await setTaxonomyApplicability(family.id, [
      { kind: "book", level: "work" },
      { kind: "film", level: "work" },
    ]);
    await replaceTaxonomyAssignments({
      familySlug: "mood",
      kind: "book",
      level: "work",
      ownerId: work.book,
      itemIds: [item.id],
    });
    await expect(
      setTaxonomyApplicability(family.id, [{ kind: "film", level: "work" }]),
    ).rejects.toThrow();
    expect((await getTaxonomyFamily("mood"))?.applicability).toHaveLength(2);
    await expect(
      c`delete from taxonomy_applicability where family_id=${family.id} and kind='book'`,
    ).rejects.toThrow();
    await expect(
      c`update taxonomy_applicability set level='film_version' where family_id=${family.id} and kind='book'`,
    ).rejects.toThrow();
  });
  it("keeps custom families isolated in edit, reorder, move, merge and assignment", async () => {
    await createTaxonomyFamily({
      name: "One",
      slug: "one",
      hierarchical: true,
    });
    await createTaxonomyFamily({
      name: "Two",
      slug: "two",
      hierarchical: true,
    });
    const a = await createTaxonomyItem("one", { name: "A" }),
      b = await createTaxonomyItem("two", { name: "B" });
    await expect(
      updateTaxonomyItem("one", b.id, { name: "Wrong" }),
    ).rejects.toThrow();
    await expect(reorderTaxonomyItems("one", [a.id, b.id])).rejects.toThrow();
    await expect(moveTaxonomyItem("one", a.id, b.id)).rejects.toThrow();
    await expect(
      mergeTaxonomyItems("one", { sourceId: a.id, targetId: b.id }),
    ).rejects.toThrow();
    await expect(
      replaceTaxonomyAssignments({
        familySlug: "one",
        kind: "book",
        level: "work",
        ownerId: work.book,
        itemIds: [b.id],
      }),
    ).rejects.toThrow();
    expect((await getTaxonomyItems("two"))[0].name).toBe("B");
  });
  it("rejects cycles, self-parenting and nonhierarchical parents and updates subtree depths", async () => {
    const a = await createTaxonomyItem("themes", { name: "A" }),
      b = await createTaxonomyItem("themes", { name: "B", parentId: a.id }),
      child = await createTaxonomyItem("themes", {
        name: "Child",
        parentId: b.id,
      });
    expect(
      (await c`select level from themes where id=${child.id}`)[0].level,
    ).toBe(3);
    await expect(moveTaxonomyItem("themes", a.id, child.id)).rejects.toThrow();
    await expect(
      c`update themes set parent_id=id where id=${a.id}`,
    ).rejects.toThrow();
    await moveTaxonomyItem("themes", b.id, null);
    expect(
      (await c`select level from themes where id=${child.id}`)[0].level,
    ).toBe(2);
    await expect(
      createTaxonomyItem("subjects", {
        name: "Invalid parent",
        parentId: a.id,
      }),
    ).rejects.toThrow();
  });
  it("rejects concurrent moves that would form a cycle", async () => {
    const a = await createTaxonomyItem("themes", { name: "A" }),
      b = await createTaxonomyItem("themes", { name: "B" });
    let unlock!: () => void, locked!: () => void;
    const gate = new Promise<void>((r) => {
        unlock = r;
      }),
      ready = new Promise<void>((r) => {
        locked = r;
      });
    const holder = c.begin(async (tx) => {
      await tx.unsafe(
        "select pg_advisory_xact_lock(hashtextextended('taxonomy-hierarchy:themes',0))",
      );
      locked();
      await gate;
    });
    await ready;
    const result = Promise.allSettled([
      moveTaxonomyItem("themes", a.id, b.id),
      moveTaxonomyItem("themes", b.id, a.id),
    ]);
    try {
      await vi.waitFor(
        async () => {
          const [r] =
            await c`select count(*)::int as total from pg_stat_activity where datname=current_database() and wait_event_type='Lock'`;
          expect(r.total).toBeGreaterThanOrEqual(2);
        },
        { timeout: 5000, interval: 20 },
      );
    } finally {
      unlock();
      await holder;
    }
    const settled = await result;
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("keeps Unicode and colliding transliterations usable and stable on rename", async () => {
    const [a, b, cyrillic] = await Promise.all([
      createTaxonomyItem("subjects", { name: "Café" }),
      createTaxonomyItem("subjects", { name: "Cafe" }),
      createTaxonomyItem("subjects", { name: "Кино" }),
    ]);
    expect(new Set([a.slug, b.slug, cyrillic.slug]).size).toBe(3);
    expect(cyrillic.slug).not.toBe("");
    await updateTaxonomyItem("subjects", a.id, { name: "Renamed" });
    expect(
      (await getTaxonomyItems("subjects")).find((i) => i.id === a.id)?.slug,
    ).toBe(a.slug);
  });
  it("merges all custom levels and children atomically and protects linked deletion", async () => {
    const family = await createTaxonomyFamily({
      name: "Both levels",
      slug: "both-levels",
      hierarchical: true,
    });
    await setTaxonomyApplicability(family.id, [
      { kind: "book", level: "work" },
      { kind: "book", level: "edition" },
    ]);
    const a = await createTaxonomyItem("both-levels", { name: "Source" }),
      b = await createTaxonomyItem("both-levels", { name: "Target" }),
      child = await createTaxonomyItem("both-levels", {
        name: "Child",
        parentId: a.id,
      });
    await replaceTaxonomyAssignments({
      familySlug: "both-levels",
      kind: "book",
      level: "work",
      ownerId: work.book,
      itemIds: [a.id, b.id],
    });
    await replaceTaxonomyAssignments({
      familySlug: "both-levels",
      kind: "book",
      level: "edition",
      ownerId: editionId,
      itemIds: [a.id],
    });
    await expect(deleteTaxonomyItem("both-levels", a.id)).rejects.toThrow();
    await expect(deleteTaxonomyFamily(family.id)).rejects.toThrow();
    await mergeTaxonomyItems("both-levels", { sourceId: a.id, targetId: b.id });
    expect(
      (await c`select item_id from custom_taxonomy_item_works`)[0].item_id,
    ).toBe(b.id);
    expect(
      (await c`select item_id from custom_taxonomy_item_editions`)[0].item_id,
    ).toBe(b.id);
    expect(
      (
        await c`select parent_id from custom_taxonomy_items where id=${child.id}`
      )[0].parent_id,
    ).toBe(b.id);
    expect(await c`select * from harmonization_operations`).toHaveLength(1);
  });
  it("rolls back failed shared and legacy multi-family assignment edits", async () => {
    const subject = await createTaxonomyItem("subjects", { name: "Original" });
    await updateWorkTaxonomy(work.book, { subjectIds: [subject.id] });
    await expect(
      updateWorkTaxonomy(work.book, {
        subjectIds: [],
        themeIds: [randomUUID()],
      }),
    ).rejects.toThrow();
    expect(
      (
        await c`select subject_id from work_subjects where work_id=${work.book}`
      )[0].subject_id,
    ).toBe(subject.id);
    await expect(
      replaceTaxonomyAssignments({
        familySlug: "subjects",
        kind: "book",
        level: "work",
        ownerId: work.book,
        itemIds: [randomUUID()],
      }),
    ).rejects.toThrow();
    expect(await c`select * from work_subjects`).toHaveLength(1);
  });
  it("protects built-in family storage and deletes unused custom items explicitly", async () => {
    const builtIn = (await getTaxonomyFamily("subjects"))!;
    await expect(deleteTaxonomyFamily(builtIn.id)).rejects.toThrow();
    await expect(
      updateTaxonomyFamily(builtIn.id, { slug: "renamed-system" }),
    ).rejects.toThrow();
    const custom = await createTaxonomyFamily({
      name: "Temporary",
      slug: "temporary",
    });
    const item = await createTaxonomyItem("temporary", { name: "Unused" });
    await deleteTaxonomyItem("temporary", item.id);
    await deleteTaxonomyFamily(custom.id);
    expect(await getTaxonomyFamily("temporary")).toBeNull();
  });
});
