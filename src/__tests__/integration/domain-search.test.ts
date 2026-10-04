import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_DOMAIN_SEARCH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln371_test")
    throw new Error("Domain search tests require disposable local sln371_test");
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
import { quickSearch } from "@/lib/actions/quick-search";
import { createFilm, getFilmCount, getFilmFilterOptions, getFilms } from "@/lib/actions/films";
import { createPerfume } from "@/lib/actions/perfumes";
import { createPerson } from "@/lib/actions/people";
import { saveOrganization } from "@/lib/actions/organizations";
import { createVenue, archiveVenue } from "@/lib/actions/venues";

describe.skipIf(!url)("search and lists across the collections", () => {
  const c = client!;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint if exists works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, venues, places, catalogue_dates, media cascade`;
  });

  /** A book with one author, as the legacy book store keeps it */
  async function book(title: string, author: string) {
    const slug = title.toLowerCase().replace(/\W+/g, "-");
    const [a] = await c`insert into authors(name, slug) values (${author}, ${`${slug}-author`}) returning id`;
    const [w] = await c`insert into works(title, slug) values (${title}, ${slug}) returning id`;
    await c`insert into work_authors(work_id, author_id, role, sort_order) values (${w.id}, ${a.id}, 'author', 0)`;
    return { id: w.id as string, slug, authorId: a.id as string };
  }

  it("keeps a book and a film of the same title apart, each at its own address", async () => {
    const novel = await book("Solaris", "Stanisław Lem");
    const tarkovsky = await createPerson({ name: "Andrei Tarkovsky", domains: ["film"], aliases: ["Андрей Тарковский"] });
    const film = await createFilm({ title: "Solaris", credits: [{ personId: tarkovsky.id, roleId: "film.director" }] });

    const { works, people } = await quickSearch("solaris");
    expect(works.map((w) => [w.kind, w.title, w.href, w.creators])).toEqual([
      ["book", "Solaris", `/library/${novel.slug}`, ["Stanisław Lem"]],
      ["film", "Solaris", expect.stringMatching(new RegExp(`^/films/(${film.id}|solaris)`)), ["Andrei Tarkovsky"]],
    ]);
    // The director's name finds the film, not the novel
    expect((await quickSearch("tarkovsky")).works.map((w) => w.kind)).toEqual(["film"]);
    expect(people).toEqual([]);
    // A director with no book opens his person page (SLN-419)
    expect((await quickSearch("tarkovsky")).people).toEqual([
      expect.objectContaining({ name: "Andrei Tarkovsky", href: `/people/${tarkovsky.slug}`, roles: "Director" }),
    ]);
  });

  it("finds names without their accents and in other scripts", async () => {
    await book("Solaris", "Stanisław Lem");
    const kurosawa = (await createPerson({ name: "黒澤明", domains: ["film"], aliases: ["Akira Kurosawa"] })).id;
    await createFilm({ title: "Rashomon", credits: [{ personId: kurosawa, roleId: "film.director" }] });
    await createPerson({ name: "Andrei Tarkovsky", domains: ["film"], aliases: ["Андрей Тарковский"] });

    expect((await quickSearch("stanislaw lem")).works.map((w) => w.title)).toEqual(["Solaris"]);
    expect((await quickSearch("Lém")).works.map((w) => w.title)).toEqual(["Solaris"]);
    expect((await quickSearch("黒澤")).works).toEqual([
      expect.objectContaining({ title: "Rashomon", creators: ["黒澤明"] }),
    ]);
    expect((await quickSearch("akira kurosawa")).people.map((p) => p.name)).toEqual(["黒澤明"]);
    // A person with no credit has no page to open yet, so no result
    expect((await quickSearch("Тарковский")).people).toEqual([]);
  });

  it("reads % and _ as plain text, never as wildcards", async () => {
    await book("100% Pure", "Ann Author");
    await book("Snake_Case", "Bob Writer");
    await book("Unrelated", "Carl Other");
    expect((await quickSearch("100%")).works.map((w) => w.title)).toEqual(["100% Pure"]);
    expect((await quickSearch("snake_case")).works.map((w) => w.title)).toEqual(["Snake_Case"]);
    expect(await quickSearch("%%")).toEqual({ works: [], people: [], organizations: [], venues: [] });
    expect((await quickSearch("__")).works).toEqual([]);
  });

  it("groups perfumes, organizations and places with their own addresses", async () => {
    const guerlain = (await saveOrganization({ name: "Guerlain", roles: ["perfume_house", "retailer"] }))!;
    const shop = (await saveOrganization({ name: "Guerlain Boutiques", roles: ["retailer"] }))!;
    const publisher = (await saveOrganization({ name: "Guerlain Éditions", roles: ["publisher"] }))!;
    await createPerfume({ title: "Shalimar", organizations: [{ organizationId: guerlain.id, role: "perfume_house" }] });
    const venue = await createVenue({ name: "Guerlain Champs-Élysées", type: "perfumery" });
    const closed = await createVenue({ name: "Guerlain Old Shop", type: "perfumery" });
    await archiveVenue(closed.id);

    const found = await quickSearch("guerlain");
    expect(found.works).toEqual([
      expect.objectContaining({ kind: "perfume", title: "Shalimar", creators: ["Guerlain"] }),
    ]);
    expect(found.works[0].href).toMatch(/^\/perfumes\//);
    // A retailer with no page of its own is left out until organizations have pages
    expect(found.organizations.map((o) => [o.name, o.href, o.roles])).toEqual([
      ["Guerlain", `/perfumes?house=${guerlain.id}`, "Perfume house · Retailer"],
      ["Guerlain Éditions", `/publishers/${publisher.slug}`, "Publisher"],
    ]);
    expect(found.organizations.map((o) => o.id)).not.toContain(shop.id);
    // Archived places stay out
    expect(found.venues).toEqual([
      { id: venue.id, name: "Guerlain Champs-Élysées", href: `/places/${venue.slug}`, type: "Perfumery" },
    ]);
  });

  it("pages a director's films in a stable order, with counts that match the pages", async () => {
    const carpenter = (await createPerson({ name: "John Carpenter", domains: ["film"] })).id;
    const ids: string[] = [];
    // Same title five times, and a sparse film with no date or runtime
    for (let i = 0; i < 5; i++)
      ids.push((await createFilm({ title: "The Thing", credits: [{ personId: carpenter, roleId: "film.director" }] })).id);
    ids.push((await createFilm({ title: "Dark Star", credits: [{ personId: carpenter, roleId: "film.director" }] })).id);
    await createFilm({ title: "Not His" });

    for (const sort of ["title", "release", "runtime", "recent", "rating"] as const) {
      const query = { directorIds: [carpenter], sort };
      const pages = [];
      for (let offset = 0; offset < 6; offset += 2)
        pages.push(...(await getFilms({ ...query, limit: 2, offset })).map((f) => f.id));
      expect(new Set(pages).size).toBe(6);
      expect([...pages].sort()).toEqual([...ids].sort());
      // The same page twice reads the same
      expect((await getFilms({ ...query, limit: 2, offset: 2 })).map((f) => f.id)).toEqual(pages.slice(2, 4));
      expect(await getFilmCount({ directorIds: [carpenter] })).toBe(6);
    }
    expect(await getFilmCount()).toBe(7);
    expect((await getFilmFilterOptions()).directors.map((d) => d.name)).toEqual(["John Carpenter"]);
  });

  it("names what a book person is: writer, translator or editor", async () => {
    const novel = await book("The Name of the Rose", "Umberto Eco");
    const [weaver] = await c`insert into authors(name, slug) values ('William Weaver', 'william-weaver') returning id`;
    const [edition] = await c`insert into editions(work_id, title) values (${novel.id}, 'The Name of the Rose') returning id`;
    await c`insert into edition_contributors(edition_id, author_id, role, sort_order) values (${edition.id}, ${weaver.id}, 'translator', 0)`;
    expect((await quickSearch("weaver")).people).toEqual([
      expect.objectContaining({ name: "William Weaver", href: "/people/william-weaver", roles: "Translator" }),
    ]);
    expect((await quickSearch("umberto eco")).people).toEqual([
      expect.objectContaining({ name: "Umberto Eco", roles: "Writer" }),
    ]);
  });

  it("finds a book by the title of its series, and a perfume by a perfumer of one formulation", async () => {
    const swann = await book("Swann's Way", "Marcel Proust");
    const [series] = await c`insert into series(title, slug) values ('In Search of Lost Time', 'in-search-of-lost-time') returning id`;
    await c`update works set series_id = ${series.id} where id = ${swann.id}`;
    expect((await quickSearch("lost time")).works.map((w) => w.title)).toEqual(["Swann's Way"]);

    const perfume = await createPerfume({ title: "Jicky" });
    const jacques = (await createPerson({ name: "Aimé Guerlain", domains: ["perfume"] })).id;
    const [variant] = await c`insert into perfume_variants(work_id, concentration, perfumers_override) values (${perfume.id}, 'eau_de_toilette', true) returning id`;
    await c`insert into perfume_variant_perfumers(variant_id, person_id, sort_order) values (${variant.id}, ${jacques}, 0)`;
    expect((await quickSearch("aime guerlain")).works).toEqual([
      expect.objectContaining({ kind: "perfume", title: "Jicky" }),
    ]);
  });
});
