import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
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

const url = process.env.DURTAL_DOMAIN_HOMES_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln364_test");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln364_test"
  )
    throw new Error("Collection home tests require disposable local sln364_test");
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
  CACHE_TAGS: {},
}));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));

import { catalogueIsEmpty, loadDomainCounts, loadRecentTiles } from "@/lib/catalogue/domain-homes";
import { createPerfume } from "@/lib/actions/perfumes";
import { createFilm } from "@/lib/actions/films";
import { createPainting } from "@/lib/actions/paintings";
import { createPerson } from "@/lib/actions/people";
import { saveOrganization } from "@/lib/actions/organizations";
import { getLibraryStats } from "@/lib/actions/works";

describe.skipIf(!url)("collection homes and dashboard counts", () => {
  const c = client!;
  const year = (value: number) => ({
    precision: "year" as const,
    start: { year: value },
  });
  let people: Record<string, string>;

  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln364_test");
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln364_test", { activateKinds: true });
    people = {};
    for (const [key, name, domain] of [
      ["beaux", "Ernest Beaux", "perfume"],
      ["carpenter", "John Carpenter", "film"],
      ["lancaster", "Bill Lancaster", "film"],
      ["munch", "Edvard Munch", "painting"],
    ] as const)
      people[key] = (await createPerson({ name, domains: [domain] })).id;
    const [author] =
      await c`insert into authors(name,slug) values ('Thomas Mann','thomas-mann') returning id`;
    const [book] =
      await c`insert into works(title,slug,original_language) values ('Doctor Faustus','doctor-faustus','de') returning id`;
    await c`insert into work_authors(work_id,author_id,role,sort_order) values (${book.id},${author.id},'author',0)`;
  }, 30000);

  async function catalogue() {
    const chanel = (await saveOrganization({
      name: "Chanel",
      roles: ["perfume_house"],
    }))!.id;
    await createPerfume({
      title: "No 5",
      releaseDate: year(1921),
      organizations: [{ organizationId: chanel, role: "perfume_house" }],
      credits: [{ personId: people.beaux, roleId: "perfume.perfumer" }],
    });
    await createPerfume({
      title: "No 19",
      credits: [{ personId: people.beaux, roleId: "perfume.perfumer" }],
    });
    await createFilm({
      title: "The Thing",
      releaseDate: year(1982),
      credits: [{ personId: people.carpenter, roleId: "film.director" }],
    });
    // A screenwriter is not a director: the dashboard counts directors only
    await createFilm({
      title: "Unfinished Script",
      credits: [{ personId: people.lancaster, roleId: "film.screenwriter" }],
    });
    await createPainting({
      title: "The Scream",
      creationDate: { precision: "range", start: { year: 1893 }, end: { year: 1910 } },
      credits: [{ personId: people.munch, roleId: "painting.painter" }],
    });
    // An unknown painter is a credit without a person
    await createPainting({
      title: "Portrait of a Man",
      credits: [{ personId: null, roleId: "painting.painter", attribution: "unknown" }],
    });
  }

  it("counts each collection's records and its credited creators, never another collection's", async () => {
    await catalogue();
    expect(await loadDomainCounts("perfume")).toEqual({ records: 2, creators: 1 });
    expect(await loadDomainCounts("film")).toEqual({ records: 2, creators: 1 });
    expect(await loadDomainCounts("painting")).toEqual({ records: 2, creators: 1 });
    expect((await getLibraryStats()).works).toBe(1);
  });

  it("counts as the books' Authors only people who wrote a book (SLN-1184)", async () => {
    // A book person with no book yet, and a book's translator, are not authors
    await createPerson({ name: "Andrei Tarkovsky", domains: ["book"] });
    const [translator] = await c`insert into authors(name,slug) values ('H. T. Lowe-Porter','h-t-lowe-porter') returning id`;
    const [edition] = await c`insert into editions(work_id,title) select id, title from works where slug = 'doctor-faustus' returning id`;
    await c`insert into edition_contributors(edition_id,author_id,role) values (${edition.id},${translator.id},'translator')`;
    expect((await getLibraryStats()).authors).toBe(1);
    // A co-author is one
    const [coAuthor] = await c`insert into authors(name,slug) values ('Theodor Adorno','theodor-adorno') returning id`;
    await c`insert into work_authors(work_id,author_id,role,sort_order) select id, ${coAuthor.id}, 'co_author', 1 from works where slug = 'doctor-faustus'`;
    expect((await getLibraryStats()).authors).toBe(2);
  });

  it("calls the catalogue empty until any collection has a record (SLN-1184)", async () => {
    expect(await catalogueIsEmpty()).toBe(false);
    await c`delete from works`;
    expect(await catalogueIsEmpty()).toBe(true);
    await createFilm({ title: "Stalker" });
    expect(await catalogueIsEmpty()).toBe(false);
  });

  it("gives each tile its link, credited creators and date", async () => {
    await catalogue();
    const perfumes = await loadRecentTiles("perfume", 10);
    const five = perfumes.find((tile) => tile.title === "No 5")!;
    const [row] = await c`select slug from works where id = ${five.id}`;
    expect(five).toMatchObject({
      href: `/perfumes/${row.slug}`,
      creators: "Chanel",
      date: "1921",
      imageUrl: null,
    });
    // Without a house, the perfumer is the credited creator
    expect(perfumes.find((tile) => tile.title === "No 19")!.creators).toBe("Ernest Beaux");
    expect((await loadRecentTiles("painting", 10)).map((tile) => tile.date).sort()).toEqual(["1893–1910", null].sort());
  });

  it("gives the dashboard the newest records first", async () => {
    await catalogue();
    await c`update works set created_at = now() - interval '1 day' where title = 'Unfinished Script'`;
    const [newest] = await loadRecentTiles("film", 1);
    expect(newest).toMatchObject({ title: "The Thing", creators: "John Carpenter", date: "1982" });
    expect(newest.createdAt).toBeInstanceOf(Date);
  });
});
