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
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_BOOK_BOUNDARY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln347_test"
  )
    throw new Error("Book-boundary tests require disposable local sln347_test");
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
vi.mock("@/lib/s3/covers", () => ({ processAndUploadCover: vi.fn() }));
import {
  getWorks,
  getWorkCount,
  getWork,
  getWorkBySlug,
  getLibraryStats,
  getWorksByAuthorId,
  getWorksWithMark,
  updateWork,
  deleteWork,
  findDuplicateWork,
} from "@/lib/actions/works";
import {
  updateHuntAssessment,
  bulkUpdateHuntAssessment,
} from "@/lib/actions/hunting";
import { setPoison, bulkSetPoison } from "@/lib/actions/poison";
import { getWorksForTimeline } from "@/lib/actions/work-timeline";
import { createEdition, updateEdition } from "@/lib/actions/editions";
import { getCollectionSelection } from "@/lib/actions/collections";
import {
  createAcquisitionTarget,
  getAcquisitionTargets,
} from "@/lib/actions/publishers";
import {
  createOrder,
  updateOrder,
  searchWorksForOrder,
} from "@/lib/actions/orders";
import {
  addWorksToSeries,
  searchWorksForSeries,
  getSeriesSuggestions,
  getSeriesDetail,
} from "@/lib/actions/series";
import {
  getSubjectsWithWorkCounts,
  updateWorkTaxonomy,
} from "@/lib/actions/taxonomy";
import {
  getTaxonomyFamilies,
  getTaxonomyItems,
  getTaxonomyItem,
} from "@/lib/actions/taxonomy-families";
import { getRecommenderList, getRecommender } from "@/lib/actions/recommenders";
import { loadDataset } from "@/lib/harmonization/store";
import { scanDataset } from "@/lib/harmonization/engine";
import { previewMerge, executeMerge } from "@/lib/harmonization/merge";
import { POST as exportCatalogue } from "@/app/api/export/route";
import { recordActivity } from "@/lib/activity/record";
import { processAndUploadCover } from "@/lib/s3/covers";

describe.skipIf(!url)("legacy book adapters with all four work kinds", () => {
  const c = client!;
  let books: string[];
  let others: { id: string; kind: string; slug: string }[];
  let author: string,
    recommender: string,
    subject: string,
    series: string,
    edition: string,
    order: string;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    // Simulate a later activation only in this explicitly disposable database.
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, subjects, recommenders, series, custom_taxonomy_items,
      comments, activity_events, gallery_layouts, harmonization_operations, harmonization_redirects cascade`;
    await c`delete from taxonomy_families where not is_system`;
    const a =
      await c`insert into authors(name,first_name,sort_name) values ('Zoe Able','Zoe','Able, Zoe'), ('Amy Zed','Amy','Zed, Amy') returning id`;
    author = a[0].id;
    const b =
      await c`insert into works(title,slug,original_year,rating,catalogue_status,is_poison) values
      ('Shared title','book-one',2001,4,'wanted',true), ('Other book','book-two',2002,5,'wanted',true) returning id`;
    books = b.map((r) => r.id);
    await c`insert into work_authors(work_id,author_id,role) values (${books[0]},${a[0].id},'author'), (${books[1]},${a[1].id},'author')`;
    // Newer, higher-rated non-books would displace books if filtering happened after paging.
    others =
      await c`insert into works(title,slug,kind,original_language,original_year,rating,catalogue_status,is_poison,created_at) values
      ('Shared title','film-one','film',null,2001,5,'tracked',true,now()+interval '1 day'),
      ('Shared title','perfume-one','perfume',null,2001,5,'tracked',true,now()+interval '2 days'),
      ('Shared title','painting-one','painting',null,2001,5,'tracked',true,now()+interval '3 days') returning id,kind,slug`;
    [recommender] = (
      await c`insert into recommenders(name) values ('Reader') returning id`
    ).map((r) => r.id);
    [subject] = (
      await c`insert into subjects(name,slug) values ('Art','art') returning id`
    ).map((r) => r.id);
    [series] = (
      await c`insert into series(title,slug) values ('Shared title','shared-title') returning id`
    ).map((r) => r.id);
    const [family] =
      await c`insert into taxonomy_families(name,slug,entity_level) values ('Mood','mood','work') returning id`;
    await c`insert into taxonomy_applicability(family_id,kind,level) select ${family.id},k::work_kind_enum,'work' from unnest(ARRAY['film','perfume','painting']) k`;
    const [item] =
      await c`insert into custom_taxonomy_items(family_id,name,slug) values (${family.id},'Dark','dark') returning id`;
    for (const id of [books[0], ...others.map((r) => r.id)]) {
      await c`insert into work_recommenders(work_id,recommender_id) values (${id},${recommender})`;
      await c`insert into work_subjects(work_id,subject_id) values (${id},${subject})`;
      await c`insert into custom_taxonomy_item_works(work_id,item_id) values (${id},${item.id})`;
      await c`insert into media(work_id,type,s3_key) values (${id},'poster',${`${id}.webp`})`;
      await c`insert into comments(entity_type,entity_id,content_html) values ('work',${id},'<p>Keep</p>')`;
    }
    [edition] = (
      await c`insert into editions(work_id,title) values (${books[0]},'Edition') returning id`
    ).map((r) => r.id);
    [order] = (
      await c`insert into orders(work_id,acquisition_method,order_date) values (${books[0]},'online_order','2026-09-30') returning id`
    ).map((r) => r.id);
    vi.clearAllMocks();
  });

  async function snapshot() {
    const tables =
      await c`select tablename from pg_tables where schemaname = 'public' order by tablename`;
    const result: Record<string, unknown> = {};
    for (const { tablename } of tables)
      result[tablename] =
        await c`select to_jsonb(r) as row from ${c(tablename)} r order by to_jsonb(r)::text`;
    return result;
  }
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

  it.each([
    "title",
    "recent",
    "rating",
    "year",
    "authorFirstName",
    "authorLastName",
  ] as const)(
    "scopes %s ordering before pagination and agrees with counts",
    async (sort) => {
      const all = await getWorks({ sort });
      expect(ids(all)).toEqual([...books].sort());
      const first = await getWorks({ sort, limit: 1 });
      const second = await getWorks({ sort, limit: 1, offset: 1 });
      expect([...first, ...second].map((r) => r.id)).toEqual(
        all.map((r) => r.id),
      );
      expect(await getWorkCount()).toBe(2);
      expect(
        await getWorkCount(undefined, { catalogueStatus: ["tracked"] }),
      ).toBe(0);
      expect(
        await getWorkCount("Shared title", { hasPoster: true, isPoison: true }),
      ).toBe(1);
      expect(
        ids(
          await getWorks({
            search: "Shared title",
            filters: { hasPoster: true },
          }),
        ),
      ).toEqual([books[0]]);
    },
  );
  it("sorts the entire book selection by the selected author name", async () => {
    expect((await getWorks({ sort: "authorFirstName", limit: 1 }))[0].id).toBe(
      books[1],
    );
    expect((await getWorks({ sort: "authorLastName", limit: 1 }))[0].id).toBe(
      books[0],
    );
    expect(
      (await getWorks({ sort: "authorFirstName", order: "desc", limit: 1 }))[0]
        .id,
    ).toBe(books[0]);
  });
  it("scopes details, dashboard, timeline, matching, and book pickers", async () => {
    for (const other of others) {
      expect(await getWork(other.id)).toBeNull();
      expect(await getWorkBySlug(other.slug)).toBeNull();
      expect(await getAcquisitionTargets(other.id)).toEqual([]);
    }
    const stats = await getLibraryStats();
    expect(stats.works).toBe(2);
    for (const rows of [
      stats.recentWorks,
      stats.topRatedWorks,
      stats.wantedWorks,
      await getWorksForTimeline(),
    ])
      expect(ids(rows)).toEqual([...books].sort());
    expect(ids(await searchWorksForOrder("Shared title"))).toEqual([books[0]]);
    expect(ids(await searchWorksForSeries("Shared title"))).toEqual([books[0]]);
    expect((await getSeriesSuggestions(series)).map((r) => r.workId)).toEqual([
      books[0],
    ]);
    expect(ids(await getWorksByAuthorId(author))).toEqual([books[0]]);
    expect(ids(await getWorksWithMark("poison", books[1]))).toEqual([books[0]]);
    expect(
      (
        await findDuplicateWork({
          title: "Shared title",
          authorName: "Zoe Able",
        })
      )?.id,
    ).toBe(books[0]);
    // Other kinds and a book with no edition join as whole works; only
    // books contribute editions
    const selection = await getCollectionSelection([...books, ...others.map((r) => r.id)], []);
    expect(selection.editions.every((e) => books.includes(e.workId))).toBe(true);
    expect(selection.works.map((r) => r.id).sort()).toEqual(
      [books[1], ...others.map((r) => r.id)].sort(),
    );
  });
  it("keeps shared recommendation and taxonomy links but counts and lists only open collections", async () => {
    expect((await getRecommenderList()).rows[0].bookCount).toBe(1);
    expect(ids((await getRecommender(recommender))!.books)).toEqual([books[0]]);
    expect((await getSubjectsWithWorkCounts())[0].workCount).toBe(1);
    for (const slug of ["subjects", "mood"]) {
      expect((await getTaxonomyItems(slug))[0].entityCount).toBe(1);
      expect(
        (await getTaxonomyItem(slug, slug === "subjects" ? "art" : "dark"))
          ?.entityIds,
      ).toEqual([books[0]]);
    }
    // A family's card counts the records of every open collection (the book,
    // the perfume, the film and the painting); its items above count books only.
    expect(
      (await getTaxonomyFamilies())
        .filter((f) => ["subjects", "mood"].includes(f.slug))
        .map((f) => f.entityCount),
    ).toEqual([4, 4]);
    expect(await c`select * from work_subjects`).toHaveLength(4);
  });
  it("exports selected books without serializing other media as publications", async () => {
    const response = await exportCatalogue(
      new NextRequest("http://localhost/api/export", {
        method: "POST",
        body: JSON.stringify({
          entity: "works",
          ids: [...books, ...others.map((r) => r.id)],
          format: "csv",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv.match(/Shared title/g)).toHaveLength(1);
    expect(csv).toContain("Other book");
  });
  it.each(["film", "perfume", "painting"])(
    "rejects every book mutation of a %s before side effects",
    async (kind) => {
      const other = others.find((r) => r.kind === kind)!;
      const before = await snapshot();
      const attempts = [
        () =>
          updateWork(other.id, {
            title: "Changed",
            authorIds: [],
            subjectIds: [],
            recommenderIds: [],
          }),
        () => deleteWork(other.id),
        () => updateWorkTaxonomy(other.id, { subjectIds: [] }),
        () => setPoison(other.id, false),
        () =>
          updateHuntAssessment(other.id, {
            isRare: true,
            huntAssessedOn: "2026-09-30",
          }),
        () => bulkSetPoison([books[0], other.id], false),
        () =>
          bulkUpdateHuntAssessment([books[0], other.id], {
            isRare: true,
            huntAssessedOn: "2026-09-30",
          }),
        () => addWorksToSeries(series, [books[0], other.id]),
        () =>
          createEdition({
            workId: other.id,
            title: "Invalid edition",
            language: "en",
          }),
        () =>
          updateEdition(edition, {
            workId: other.id,
            coverSourceUrl: "https://example.com/cover.jpg",
          }),
        () => createAcquisitionTarget({ workId: other.id }),
        () =>
          createOrder({
            workId: other.id,
            acquisitionMethod: "online_order",
            orderDate: "2026-09-30",
          }),
        () => updateOrder(order, { workId: other.id }),
      ];
      for (const attempt of attempts)
        await expect(attempt()).rejects.toThrow(/(?:Book|Work) not found/);
      expect(await snapshot()).toEqual(before);
      expect(recordActivity).not.toHaveBeenCalled();
      expect(processAndUploadCover).not.toHaveBeenCalled();
    },
  );
  it.each(["film", "perfume", "painting"])(
    "enforces book-only references for direct SQL and reparenting to %s",
    async (kind) => {
      const other = others.find((r) => r.kind === kind)!;
      const statements = [
        () =>
          c`insert into editions(work_id,title) values (${other.id},'Invalid')`,
        () =>
          c`update editions set work_id = ${other.id} where id = ${edition}`,
        () =>
          c`insert into work_authors(work_id,author_id,role) values (${other.id},${author},'author')`,
        () => c`insert into acquisition_targets(work_id) values (${other.id})`,
        () =>
          c`insert into orders(work_id,acquisition_method,order_date) values (${other.id},'gift','2026-09-30')`,
        () => c`update orders set work_id = ${other.id} where id = ${order}`,
        () =>
          c`insert into calibre_books(calibre_id,title,path,work_id) values (99,'Invalid','path',${other.id})`,
        () =>
          c`insert into work_status_history(work_id,to_status) values (${other.id},'accessioned')`,
        () =>
          c`insert into readings(work_id,started_precision) values (${other.id},'unknown')`,
        async () => {
          const [read] =
            await c`insert into readings(work_id,status,started_precision) values (${books[0]},'finished','unknown') returning id`;
          return c`update readings set work_id = ${other.id} where id = ${read.id}`;
        },
      ];
      for (const statement of statements)
        await expect(statement()).rejects.toMatchObject({
          code: "23514",
          constraint_name: "book_parent_required",
        });
      await expect(
        c`update works set series_id = ${series} where id = ${other.id}`,
      ).rejects.toMatchObject({ constraint_name: "works_book_series_check" });
    },
  );
  it("keeps scans and executable merges within book scope", async () => {
    const data = await loadDataset();
    expect(ids(data.works)).toEqual([...books].sort());
    expect(
      scanDataset(data)
        .flatMap((f) => f.records)
        .some((r) => others.some((o) => o.id === r.id)),
    ).toBe(false);
    for (const [sourceId, targetId] of [
      [books[0], others[0].id],
      [others[0].id, others[1].id],
      [others[0].id, books[0]],
    ]) {
      const preview = await previewMerge("works", sourceId, targetId);
      expect(preview.blockers.join(" ")).toContain("cannot be merged");
      await expect(
        executeMerge({
          entity: "works",
          sourceId,
          targetId,
          fingerprint: preview.fingerprint,
          choices: {},
        }),
      ).rejects.toThrow("cannot be merged");
    }
  });
  it("still accepts ordinary book edits, edition creation, targets, and series membership", async () => {
    await updateWork(books[0], { notes: "Book note" });
    await setPoison(books[0], false);
    await addWorksToSeries(series, books);
    expect((await getSeriesDetail(series))?.works).toHaveLength(2);
    await createEdition({
      workId: books[1],
      title: "Another edition",
      language: "en",
    });
    await createAcquisitionTarget({ workId: books[1] });
    expect(await getAcquisitionTargets(books[1])).toHaveLength(1);
  });
});
