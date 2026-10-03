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

const url = process.env.DURTAL_DOMAIN_HOMES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln364_test"
  )
    throw new Error("Collection home tests require disposable local sln364_test");
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
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));

import {
  loadDomainCounts,
  loadDomainHome,
  loadRecentTiles,
} from "@/lib/catalogue/domain-homes";
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
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, catalogue_dates, activity_events cascade`;
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
  });

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

  it("reads a home page from its URL: search, a valid sort, and paging", async () => {
    await catalogue();
    const home = await loadDomainHome("perfume", { q: "no", sort: "year" });
    expect(home.total).toBe(2);
    // Titles sort naturally: "No 5" before "No 19"
    expect(home.tiles.map((tile) => tile.title)).toEqual(["No 5", "No 19"]);
    const five = home.tiles[0];
    const [row] = await c`select slug from works where id = ${five.id}`;
    expect(five).toMatchObject({
      href: `/perfumes/${row.slug}`,
      creators: "Chanel",
      date: "1921",
      imageUrl: null,
    });
    // Without a house, the perfumer is the credited creator
    expect(home.tiles[1].creators).toBe("Ernest Beaux");
    expect(
      (await loadDomainHome("perfume", { sort: "title", order: "desc" })).tiles.map(
        (tile) => tile.title,
      ),
    ).toEqual(["No 19", "No 5"]);
    const beyond = await loadDomainHome("perfume", { page: "2", perPage: "24" });
    expect(beyond).toMatchObject({ total: 2, page: 2, perPage: 24, tiles: [] });
    expect((await loadDomainHome("painting", {})).tiles.map((tile) => tile.date)).toEqual([
      null,
      "1893–1910",
    ]);
  });

  it("gives the dashboard the newest records first", async () => {
    await catalogue();
    await c`update works set created_at = now() - interval '1 day' where title = 'Unfinished Script'`;
    const [newest] = await loadRecentTiles("film", 1);
    expect(newest).toMatchObject({ title: "The Thing", creators: "John Carpenter", date: "1982" });
    expect(newest.createdAt).toBeInstanceOf(Date);
  });
});
