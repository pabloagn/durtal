import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_RECORD_EXISTS_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln286_test");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln286_test")
    throw new Error("Record existence tests require disposable local sln286_test");
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
import {
  authorExists,
  ebookExists,
  organizationExists,
  publisherExists,
  workRecordExists,
} from "@/lib/catalogue/record-exists";

describe.skipIf(!url)("detail layouts know a missing record before the page starts", () => {
  const c = client!;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln286_test");
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln286_test");
  }, 30000);

  const work = async (kind: "book" | "film" | "perfume" | "painting", slug: string) =>
    (
      await c`insert into works(title, slug, kind, original_language) values (${slug}, ${slug}, ${kind}, ${kind === "book" ? "en" : null}) returning id`
    )[0].id as string;

  it("finds a film, perfume or painting by slug or id, with its profile", async () => {
    const film = await work("film", "the-thing");
    await c`insert into film_details(work_id) values (${film})`;
    const perfume = await work("perfume", "shalimar");
    await c`insert into perfume_details(work_id) values (${perfume})`;
    const painting = await work("painting", "the-night-watch");
    await c`insert into painting_details(work_id) values (${painting})`;

    expect(await workRecordExists("film", "the-thing")).toBe(true);
    expect(await workRecordExists("film", film)).toBe(true);
    expect(await workRecordExists("perfume", "shalimar")).toBe(true);
    expect(await workRecordExists("painting", painting)).toBe(true);
  });

  it("refuses another kind's record, a work with no profile, and a missing one", async () => {
    await work("book", "the-thing");
    const bare = await work("film", "no-profile");
    const perfume = await work("perfume", "shalimar");
    await c`insert into perfume_details(work_id) values (${perfume})`;

    expect(await workRecordExists("film", "the-thing")).toBe(false);
    expect(await workRecordExists("film", "no-profile")).toBe(false);
    expect(await workRecordExists("film", bare)).toBe(false);
    expect(await workRecordExists("film", "shalimar")).toBe(false);
    expect(await workRecordExists("painting", "deleted-long-ago")).toBe(false);
  });

  it("decodes the address, and treats undecodable or overlong text as missing", async () => {
    const film = await work("film", "été");
    await c`insert into film_details(work_id) values (${film})`;

    expect(await workRecordExists("film", encodeURIComponent("été"))).toBe(true);
    expect(await workRecordExists("film", "%E0%A4%A")).toBe(false);
    expect(await workRecordExists("film", "x".repeat(1001))).toBe(false);
    expect(await organizationExists("%")).toBe(false);
  });

  it("finds organizations by slug or id, and publishers only with a publishing profile", async () => {
    const [{ id: house }] = await c`insert into publishing_houses(name, slug, kind) values ('Guerlain', 'guerlain', null) returning id`;
    await c`insert into publishing_houses(name, slug, kind) values ('Gallimard', 'gallimard', 'publisher')`;

    expect(await organizationExists("guerlain")).toBe(true);
    expect(await organizationExists(house as string)).toBe(true);
    expect(await organizationExists("nobody")).toBe(false);
    expect(await publisherExists("gallimard")).toBe(true);
    expect(await publisherExists("guerlain")).toBe(false);
    expect(await publisherExists("nobody")).toBe(false);
  });

  // The person and eBook pages took loading screens (task 0610)
  it("finds a person by slug and an eBook by id, in either case", async () => {
    await c`insert into authors(name, slug) values ('André Breton', 'andre-breton')`;
    const [{ id: ebook }] = await c`insert into ebooks(title, language, import_source) values ('Nadja', 'fr', 'folder') returning id`;

    expect(await authorExists("andre-breton")).toBe(true);
    expect(await authorExists("nobody")).toBe(false);
    expect(await authorExists("x".repeat(1001))).toBe(false);
    expect(await ebookExists(ebook as string)).toBe(true);
    expect(await ebookExists((ebook as string).toUpperCase())).toBe(true);
    expect(await ebookExists("00000000-0000-4000-a000-000000000000")).toBe(false);
    expect(await ebookExists("nadja")).toBe(false);
  });
});
