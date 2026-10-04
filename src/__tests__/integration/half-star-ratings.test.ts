import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_HALF_STAR_RATINGS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln446_half_star_ratings")
    throw new Error("Half-star rating tests require a disposable local sln446_half_star_ratings database");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, prop) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, prop);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { getWorks, updateWork } from "@/lib/actions/works";
import { getFilms } from "@/lib/actions/films";
import { getPerfumes } from "@/lib/actions/perfumes";
import { getPaintings } from "@/lib/actions/paintings";
import { updateWorkCuration, getWorkCuration } from "@/lib/actions/curation";
import { getPublisherBooks, parsePublisherBookQuery } from "@/lib/publishers/books";
import { savePublisher } from "@/lib/actions/publishers";

describe.skipIf(!url)("half-star ratings with PostgreSQL", () => {
  const db = testDb!;
  const q = (text: string, params: unknown[] = []) =>
    client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) =>
    Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await q(`truncate works, publishing_houses cascade`);
  });

  let serial = 0;
  const book = (title: string, rating: number | null) =>
    value(`insert into works(title, slug, rating) values ($1, $2, $3) returning id`, [title, `${title.toLowerCase()}-${++serial}`, rating]);
  const other = async (kind: string, title: string, rating: number) => {
    const id = await value(`insert into works(kind, title, slug, original_language, rating) values ($1, $2, $3, null, $4) returning id`, [
      kind,
      title,
      `${title.toLowerCase()}-${++serial}`,
      rating,
    ]);
    await q(`insert into ${kind}_details(work_id) values ($1)`, [id]);
    return id;
  };

  it("filters the library by a half-step minimum", async () => {
    await book("Four", 4);
    await book("FourHalf", 4.5);
    await book("Five", 5);
    await book("None", null);
    const titles = (await getWorks({ filters: { minRating: 4.5 }, sort: "title" })).map((w) => w.title);
    expect(titles.sort()).toEqual(["Five", "FourHalf"]);
  });

  it("puts unrated works last when sorting by rating, either way", async () => {
    await book("None", null);
    await book("Three", 3);
    await book("FourHalf", 4.5);
    expect((await getWorks({ sort: "rating", order: "desc" })).map((w) => w.title)).toEqual(["FourHalf", "Three", "None"]);
    expect((await getWorks({ sort: "rating", order: "asc" })).map((w) => w.title)).toEqual(["Three", "FourHalf", "None"]);
    expect((await getWorks({ sort: "rating" }))[0].rating).toBe(4.5);
  });

  it("saves a half star on a book and on a film", async () => {
    const id = await book("Watt", null);
    await updateWork(id, { rating: 3.5 });
    expect(await value<number>(`select rating::float8 from works where id = $1`, [id])).toBe(3.5);
    const film = await other("film", "Stalker", 4);
    const current = (await getWorkCuration({ id: film, kind: "film" }))!;
    expect(current.rating).toBe(4);
    await updateWorkCuration({ owner: { id: film, kind: "film" }, fingerprint: current.fingerprint, patch: { rating: 4.5 } });
    expect((await getWorkCuration({ id: film, kind: "film" }))!.rating).toBe(4.5);
  });

  it("returns a 4.5 rating as the number 4.5 from the film, perfume, painting and publisher lists", async () => {
    await other("film", "Stalker", 4.5);
    await other("perfume", "Mitsouko", 4.5);
    await other("painting", "Automat", 4.5);
    expect((await getFilms({ sort: "rating" }))[0].rating).toBe(4.5);
    expect((await getPerfumes({ sort: "rating" }))[0].rating).toBe(4.5);
    expect((await getPaintings({ sort: "rating" }))[0].rating).toBe(4.5);
    const house = (await savePublisher({ name: "Half House" }))!.id;
    const id = await book("Molloy", 4.5);
    const edition = await value(`insert into editions(work_id, title, language) values ($1, 'Molloy', 'en') returning id`, [id]);
    await q(`insert into edition_publishers(edition_id, publisher_id) values ($1, $2)`, [edition, house]);
    expect((await getPublisherBooks(house, parsePublisherBookQuery({}))).books[0].rating).toBe(4.5);
  });
});
