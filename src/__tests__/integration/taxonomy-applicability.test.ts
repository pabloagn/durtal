import { redirectMergedRecord } from "@/lib/harmonization/redirect";
import { getTaxonomyBrowsePage, getTaxonomyBookPage, getTaxonomyBookCards, getTaxonomyTerm, getTaxonomyEditorChoices } from "@/lib/actions/taxonomy-browse";
import { compareWorks } from "@/lib/utils/title-order";
import { deleteTaxonomyItem as deleteItemUi, mergeTaxonomyItems as mergeItemsUi } from "@/lib/actions/taxonomy-ui";
import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
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
import * as schema from "@/lib/db/schema";
import { DOMAIN_TAXONOMIES } from "@/lib/catalogue/taxonomies";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
const url = process.env.DURTAL_TAXONOMY_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln352_test");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln352_test"
  )
    throw new Error("Taxonomy tests require disposable local sln352_test");
}
const client = url ? postgres(url, { prepare: false, max: 5, onnotice: () => {} }) : null;
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
  getTaxonomyFamilyUsage,
} from "@/lib/actions/taxonomy-families";
import { updateWorkTaxonomy } from "@/lib/actions/taxonomy";

describe.skipIf(!url)("domain and level-aware taxonomy", () => {
  const c = client!;
  let work: Record<string, string>, editionId: string;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln352_test");
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln352_test", { activateKinds: true });
    await c`delete from taxonomy_families where not is_system`;
    const rows =
      await c`insert into works(title,slug,kind,original_language) values ('Book','book','book','en'),('Film','film','film',null),('Perfume','perfume','perfume',null),('Painting','painting','painting',null) returning id,kind`;
    work = Object.fromEntries(rows.map((r) => [r.kind, r.id]));
    const [edition] =
      await c`insert into editions(work_id,title) values (${work.book},'Edition') returning id`;
    editionId = edition.id;
  }, 30000);
  it("pages and filters 900 terms without shipping off-page records or descriptions", async () => {
    await c`insert into subjects(name,slug) select case when n=889 then 'Étrange subject' else 'Scale subject '||n end,'scale-'||n from generate_series(1,900) n`;
    const first=(await getTaxonomyBrowsePage("subjects",{}))!;
    const second=(await getTaxonomyBrowsePage("subjects",{page:"2"}))!;
    expect(first.total).toBe(900); expect(first.items).toHaveLength(48);
    expect(new Set([...first.items,...second.items].map(i=>i.id)).size).toBe(96);
    expect(first.items.every(i=>!("description" in i))).toBe(true);
    expect((await getTaxonomyBrowsePage("subjects",{q:"ETRANGE"}))?.items.map(i=>i.name)).toEqual(["Étrange subject"]);
    expect((await getTaxonomyBrowsePage("subjects",{page:"999"}))?.items).toEqual([]);
    expect(await getTaxonomyEditorChoices("subjects")).toHaveLength(900);
  });
  it("keeps small trees whole and loads only the opened large branch", async () => {
    const f=await createTaxonomyFamily({name:"Tree scale",hierarchical:true,scopes:[{kind:"book",level:"work"}]});
    const root=await createTaxonomyItem(f.slug,{name:"Root"});
    const child=await createTaxonomyItem(f.slug,{name:"Child",parentId:root.id});
    expect((await getTaxonomyBrowsePage(f.slug))?.items).toHaveLength(2);
    await c`insert into custom_taxonomy_items(family_id,name,slug,parent_id) select ${f.id},'Branch '||n,'branch-'||n,${root.id} from generate_series(1,220) n`;
    const list=(await getTaxonomyBrowsePage(f.slug))!;
    expect(list.wholeTree).toBe(false); expect(list.items.map(i=>i.id)).toEqual([root.id]);
    const branch=(await getTaxonomyBrowsePage(f.slug,{},root.id))!;
    expect(branch.total).toBe(221); expect(branch.items).toHaveLength(48);
    const more=(await getTaxonomyBrowsePage(f.slug,{},root.id,48))!;
    expect(new Set([...branch.items,...more.items].map(i=>i.id)).size).toBe(96);
    expect((await getTaxonomyTerm(f.slug,child.slug))?.parents.map(i=>i.id)).toEqual([root.id]);
  });
  it("paginates 250 linked books with lean cards and preserves natural title ordering", async () => {
    const term=await createTaxonomyItem("subjects",{name:"Scale books"});
    const rows=await c`insert into works(title,slug,kind) select 'Volume '||n,'volume-'||n,'book' from generate_series(1,250) n returning id,title`;
    await c`insert into work_subjects(work_id,subject_id) select id,${term.id} from works where slug like 'volume-%'`;
    const page=await getTaxonomyBookPage("subjects",term.id,{});
    expect(page.total).toBe(250); expect(page.ids).toHaveLength(48);
    expect(page.ids).toEqual(rows.map(r=>({id:String(r.id),title:String(r.title)})).sort(compareWorks).slice(0,48).map(i=>i.id));
    const cards=await getTaxonomyBookCards(page.ids); expect(cards).toHaveLength(48);
    expect(cards.map(w=>w.id)).toEqual(page.ids); expect(cards.every(w=>!("description" in w))).toBe(true);
    const next=await getTaxonomyBookPage("subjects",term.id,{page:"2"});
    expect(new Set([...page.ids,...next.ids]).size).toBe(96);
  });
  it("counts descendants distinctly and maps edition terms to their parent book once", async () => {
    const root=await createTaxonomyItem("categories",{name:"Root"});
    const mid=await createTaxonomyItem("categories",{name:"Middle",parentId:root.id});
    const leaf=await createTaxonomyItem("categories",{name:"Leaf",parentId:mid.id});
    await c`insert into work_categories(work_id,category_id) values (${work.book},${mid.id}),(${work.book},${leaf.id})`;
    const term=(await getTaxonomyTerm("categories",leaf.slug))!;
    expect(term.parents.map(p=>p.id)).toEqual([root.id,mid.id]);
    expect((await getTaxonomyTerm("categories",root.slug))).toMatchObject({direct:0,below:1});
    const genre=await createTaxonomyItem("genres",{name:"Edition genre"});
    const [second]=await c`insert into editions(work_id,title) values (${work.book},'Second edition') returning id`;
    await c`insert into edition_genres(edition_id,genre_id) values (${editionId},${genre.id}),(${second.id},${genre.id})`;
    expect((await getTaxonomyTerm("genres",genre.slug))?.direct).toBe(2);
    const page=await getTaxonomyBookPage("genres",genre.id,{});
    expect(page.total).toBe(1); expect(page.ids).toEqual([work.book]);
  });
  it("redirects merged custom terms only inside their family", async () => {
    const f=await createTaxonomyFamily({name:"Redirect family",scopes:[{kind:"book",level:"work"}]});
    const other=await createTaxonomyFamily({name:"Other family",scopes:[{kind:"book",level:"work"}]});
    const source=await createTaxonomyItem(f.slug,{name:"Old term"}),target=await createTaxonomyItem(f.slug,{name:"Survivor"});
    await mergeTaxonomyItems(f.slug,{sourceId:source.id,targetId:target.id});
    await expect(redirectMergedRecord("custom-taxonomy",source.slug,`/taxonomy/${f.slug}`,f.id)).rejects.toMatchObject({digest:expect.stringContaining(`/taxonomy/${f.slug}/${target.slug}`)});
    await expect(redirectMergedRecord("custom-taxonomy",source.slug,`/taxonomy/${other.slug}`,other.id)).resolves.toBeUndefined();
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
    // Every collection is open, so each one's own families are listed
    const listed = (await getTaxonomyFamilies()).map((f) => f.slug);
    expect(listed).toContain("film-genres");
    expect(listed).toContain("painting-genres");
    await expect(
      getApplicableTaxonomyFamilies("book", "film_version"),
    ).rejects.toThrow();
  });
  it("keeps partial reorders stable and appends concurrent creations without ties", async () => {
    await createTaxonomyFamily({ name: "Ordering proof", hierarchical: true, scopes: [{ kind: "book", level: "work" }] });
    const a = await createTaxonomyItem("ordering-proof", { name: "A" });
    const b = await createTaxonomyItem("ordering-proof", { name: "B" });
    const cItem = await createTaxonomyItem("ordering-proof", { name: "C" });
    await reorderTaxonomyItems("ordering-proof", [cItem.id, a.id]);
    let items = await getTaxonomyItems("ordering-proof");
    expect(items.map(i => i.id)).toEqual([cItem.id, b.id, a.id]);
    expect(items.map(i => i.sortOrder)).toEqual([0, 1, 2]);
    await Promise.all([createTaxonomyItem("ordering-proof", { name: "D" }), createTaxonomyItem("ordering-proof", { name: "E" })]);
    items = await getTaxonomyItems("ordering-proof");
    expect(items.map(i => i.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns child and context protections as data without removing records", async () => {
    await createTaxonomyFamily({ name: "Protected tree", hierarchical: true, scopes: [{ kind: "book", level: "work" }] });
    const parent = await createTaxonomyItem("protected-tree", { name: "Parent" });
    const other = await createTaxonomyItem("protected-tree", { name: "Other" });
    const child = await createTaxonomyItem("protected-tree", { name: "Child", parentId: parent.id });
    const cousin = await createTaxonomyItem("protected-tree", { name: "Cousin", parentId: other.id });
    expect(await deleteItemUi("protected-tree", parent.id)).toMatchObject({ ok: false, error: "Move this item's children before deleting it" });
    const refused = await mergeItemsUi("protected-tree", { sourceId: child.id, targetId: cousin.id });
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("different contexts") });
    expect((await getTaxonomyItems("protected-tree")).map(i => i.id).sort()).toEqual([parent.id, other.id, child.id, cousin.id].sort());
    expect((await getTaxonomyItems("protected-tree")).find(i => i.id === parent.id)?.childCount).toBe(1);
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
    const family = await createTaxonomyFamily({ name: "Mood", scopes: [{ kind: "book", level: "work" }] });
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
      name: "One", scopes: [{ kind: "book", level: "work" }],
      hierarchical: true,
    });
    await createTaxonomyFamily({
      name: "Two", scopes: [{ kind: "book", level: "work" }],
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
      name: "Both levels", scopes: [{ kind: "book", level: "work" }],
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
      updateTaxonomyFamily(builtIn.id, { slug: "renamed-system" } as never),
    ).rejects.toThrow();
    await expect(
      updateTaxonomyFamily(builtIn.id, { hierarchical: true }),
    ).rejects.toThrow(/^Taxonomy storage identity is immutable$/);
    const custom = await createTaxonomyFamily({
      name: "Temporary", scopes: [{ kind: "book", level: "work" }],
    });
    const item = await createTaxonomyItem("temporary", { name: "Unused" });
    await deleteTaxonomyItem("temporary", item.id);
    await deleteTaxonomyFamily(custom.id);
    expect(await getTaxonomyFamily("temporary")).toBeNull();
  });

  it("deletes a parent with no links by moving its narrower items up a level", async () => {
    const fiction = await createTaxonomyItem("categories", { name: "Fiction" }),
      novel = await createTaxonomyItem("categories", { name: "Novel", parentId: fiction.id }),
      gothic = await createTaxonomyItem("categories", { name: "Gothic novel", parentId: novel.id });
    // Without the choice the parent stays, with its reason
    await expect(deleteTaxonomyItem("categories", novel.id)).rejects.toThrow(/^Move this item's children before deleting it$/);
    await deleteTaxonomyItem("categories", novel.id, undefined, true);
    expect((await c`select parent_id,level from book_categories where id=${gothic.id}`)[0]).toEqual({ parent_id: fiction.id, level: 2 });
    expect(await c`select id from book_categories where id=${novel.id}`).toHaveLength(0);
    // Links still refuse the delete, and nothing moves
    await c`insert into work_categories(work_id,category_id) values (${work.book},${fiction.id})`;
    await expect(deleteTaxonomyItem("categories", fiction.id, undefined, true)).rejects.toThrow(/^Reassign this item's catalogue links/);
    expect((await c`select parent_id from book_categories where id=${gothic.id}`)[0].parent_id).toBe(fiction.id);
    // A custom family's top-level parent leaves its children at the top level
    await createTaxonomyFamily({ name: "Mood", scopes: [{ kind: "book", level: "work" }], hierarchical: true });
    const dark = await createTaxonomyItem("mood", { name: "Dark" }),
      noir = await createTaxonomyItem("mood", { name: "Noir", parentId: dark.id });
    await deleteTaxonomyItem("mood", dark.id, undefined, true);
    expect((await c`select parent_id from custom_taxonomy_items where id=${noir.id}`)[0].parent_id).toBeNull();
  });

  it("puts the narrower items where their deleted parent stood, in their own order", async () => {
    const poetry = await createTaxonomyItem("categories", { name: "Poetry" }),
      drama = await createTaxonomyItem("categories", { name: "Drama" }),
      villanelle = await createTaxonomyItem("categories", { name: "Villanelle", parentId: poetry.id }),
      sonnet = await createTaxonomyItem("categories", { name: "Sonnet", parentId: poetry.id });
    await deleteTaxonomyItem("categories", poetry.id, undefined, true);
    const top = await c`select id from book_categories where parent_id is null and id in (${drama.id},${villanelle.id},${sonnet.id}) order by sort_order,lower(name),id`;
    expect(top.map((r) => r.id)).toEqual([villanelle.id, sonnet.id, drama.id]);
  });

  it("creates families with exactly the chosen scopes and keeps their URL on rename", async () => {
    const film = await createTaxonomyFamily({ name: "Mood", scopes: [{ kind: "film", level: "work" }] });
    expect(film.slug).toBe("mood");
    expect(film.applicability.map(({ kind, level }) => ({ kind, level }))).toEqual([{ kind: "film", level: "work" }]);
    const twin = await createTaxonomyFamily({ name: "Mood!", scopes: [{ kind: "book", level: "edition" }] });
    expect(twin.slug).toBe("mood-2");
    expect(twin.entityLevel).toBe("edition");
    await expect(
      createTaxonomyFamily({ name: "Mood", scopes: [{ kind: "book", level: "work" }] }),
    ).rejects.toThrow(/^A taxonomy family with this name already exists$/);
    await expect(
      createTaxonomyFamily({ name: "Nowhere", scopes: [{ kind: "book", level: "art_object" }] }),
    ).rejects.toThrow();
    await expect(createTaxonomyFamily({ name: "Empty", scopes: [] })).rejects.toThrow();
    const renamed = await updateTaxonomyFamily(film.id, { name: "Atmosphere", color: "#5a6b7c" });
    expect(renamed).toMatchObject({ name: "Atmosphere", slug: "mood", color: "#5a6b7c" });
    await expect(updateTaxonomyFamily(film.id, { color: "red" })).rejects.toThrow();
  });
  it("lists only families of enabled domains, with all their scopes", async () => {
    const paintingOnly = await createTaxonomyFamily({ name: "Painting only", scopes: [{ kind: "painting", level: "work" }] });
    const shared = await createTaxonomyFamily({
      name: "Shared",
      scopes: [{ kind: "book", level: "work" }, { kind: "painting", level: "work" }],
    });
    // Every collection is open: close paintings for this one read
    const painting = WORK_DOMAINS.painting as unknown as { enabled: boolean };
    painting.enabled = false;
    const listed = await getTaxonomyFamilies().finally(() => {
      painting.enabled = true;
    });
    expect(listed.some((f) => f.id === paintingOnly.id)).toBe(false);
    expect(listed.find((f) => f.id === shared.id)?.scopes).toEqual(
      expect.arrayContaining([{ kind: "book", level: "work" }, { kind: "painting", level: "work" }]),
    );
    expect(listed.some((f) => f.slug === "painting-genres")).toBe(false);
    // Films are open, so their own family is listed
    expect(listed.some((f) => f.slug === "film-genres")).toBe(true);
  });
  it("shares one family across two domains and explains used scopes before changes", async () => {
    const shared = await createTaxonomyFamily({
      name: "Shared mood",
      scopes: [{ kind: "book", level: "work" }, { kind: "film", level: "work" }],
      hierarchical: true,
    });
    const dark = await createTaxonomyItem(shared.slug, { name: "Dark" });
    await createTaxonomyItem(shared.slug, { name: "Noir", parentId: dark.id });
    for (const kind of ["book", "film"] as const)
      await replaceTaxonomyAssignments({ familySlug: shared.slug, kind, level: "work", ownerId: work[kind], itemIds: [dark.id] });
    await expect(
      replaceTaxonomyAssignments({ familySlug: shared.slug, kind: "perfume", level: "work", ownerId: work.perfume, itemIds: [dark.id] }),
    ).rejects.toThrow();
    expect(await getTaxonomyFamilyUsage(shared.id)).toEqual({
      itemCount: 2,
      scopes: [
        { kind: "book", level: "work", inUse: true },
        { kind: "film", level: "work", inUse: true },
      ],
      deletable: false,
    });
    await expect(setTaxonomyApplicability(shared.id, [{ kind: "book", level: "work" }])).rejects.toThrow(
      /^Remove or reassign taxonomy links before removing this scope$/,
    );
    await expect(deleteTaxonomyFamily(shared.id)).rejects.toThrow(
      /^Records still use this family; reassign or remove those classifications first$/,
    );
    expect(await c`select id from custom_taxonomy_items where family_id=${shared.id}`).toHaveLength(2);
    await replaceTaxonomyAssignments({ familySlug: shared.slug, kind: "film", level: "work", ownerId: work.film, itemIds: [] });
    await setTaxonomyApplicability(shared.id, [{ kind: "book", level: "work" }]);
    await replaceTaxonomyAssignments({ familySlug: shared.slug, kind: "book", level: "work", ownerId: work.book, itemIds: [] });
    expect((await getTaxonomyFamilyUsage(shared.id))!.deletable).toBe(true);
    await deleteTaxonomyFamily(shared.id);
    expect(await getTaxonomyFamily(shared.slug)).toBeNull();
    expect(await c`select id from custom_taxonomy_items where family_id=${shared.id}`).toHaveLength(0);
    const subjects = (await getTaxonomyFamily("subjects"))!;
    await expect(deleteTaxonomyFamily(subjects.id)).rejects.toThrow(/^System families cannot be deleted$/);
    expect((await getTaxonomyFamilyUsage(subjects.id))!.deletable).toBe(false);
  });
});
