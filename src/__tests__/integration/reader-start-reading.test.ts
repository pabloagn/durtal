import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

// SLN-669: "Track this book" on a book with no reading yet. No environment-file
// or live fallback: a disposable local database only.
const url = process.env.DURTAL_READER_START_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln669_reader_start")
    throw new Error("Reader start tests require disposable local sln669_reader_start");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
const device = randomUUID();
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_, prop) => {
  if (!testDb) throw new Error("Disposable reader start database required");
  return Reflect.get(testDb, prop);
} }) }));
vi.mock("@/lib/cache", () => ({ cached: (fn: unknown) => fn, invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => name === "durtal-device" ? { name, value: device } : undefined,
}) }));
import { startReaderReading } from "@/lib/actions/reader-tracking";
import { readingDay } from "@/lib/reading/dates";

type Queries = Pick<postgres.Sql, "unsafe">;
async function value<T = string>(on: Queries, text: string, params: postgres.ParameterOrJSON<never>[] = []): Promise<T> {
  return Object.values((await on.unsafe(text, params))[0])[0] as T;
}

describe.skipIf(!url)("starting a reading from the reader", () => {
  const c = client!;
  beforeAll(async () => {
    await migrate(drizzle(c), { migrationsFolder: "src/lib/db/migrations" });
    if (!(await value<number>(c, "select count(*)::int from app_settings")))
      await c.unsafe("insert into app_settings default values");
  }, 60000);
  afterAll(async () => { await client?.end(); });

  async function linkedEbook() {
    const key = randomUUID();
    const work = await value(c, `insert into works(title,slug,kind,original_language) values ('Start test',$1,'book','en') returning id`, [`start-${key}`]);
    const edition = await value(c, `insert into editions(work_id,title,language) values ($1,'Start test','en') returning id`, [work]);
    const home = await value(c, `insert into locations(name,type) values ($1,'digital') returning id`, [`Start ${key}`]);
    const copy = await value(c, `insert into instances(edition_id,location_id,format) values ($1,$2,'ebook') returning id`, [edition, home]);
    const ebook = await value(c, `insert into ebooks(title,import_source,instance_id,match_state) values ('Start test','folder',$1,'linked') returning id`, [copy]);
    return { work, ebook };
  }

  it("creates the first reading with today's reading day as its start", async () => {
    const { work, ebook } = await linkedEbook();
    const timeZone = "Europe/Paris";
    const started = await startReaderReading({ ebookId: ebook, startPercent: 12.5, timeZone });
    expect(started.created).toBe(true);
    const [row] = await c.unsafe(`select status, source, format, started_precision, to_char(started_on,'YYYY-MM-DD') as started_on
      from readings where work_id=$1`, [work]);
    const hour = await value<number>(c, "select reading_day_start_hour from app_settings limit 1");
    expect(row).toMatchObject({ status: "reading", format: "ebook", started_precision: "day",
      started_on: readingDay(new Date(), timeZone, hour) });
  });

  it("joins the open reading instead of starting a second one", async () => {
    const { work, ebook } = await linkedEbook();
    await startReaderReading({ ebookId: ebook, startPercent: 0, timeZone: "UTC" });
    const again = await startReaderReading({ ebookId: ebook, startPercent: 3, timeZone: "UTC" });
    expect(again.created).toBe(false);
    expect(await value<number>(c, "select count(*)::int from readings where work_id=$1", [work])).toBe(1);
  });
});
