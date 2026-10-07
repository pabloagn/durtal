import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_EBOOK_CATALOGUE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln490_ebook_catalogue")
    throw new Error("E-book catalogue tests require disposable local sln490_ebook_catalogue");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
const queries: string[] = [];
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local test database required");
        const value = Reflect.get(testDb, key);
        // Count the queries the e-book reads send
        if (key === "execute") return (...args: unknown[]) => (queries.push("execute"), (value as (...a: unknown[]) => unknown).apply(testDb, args));
        return value;
      },
    },
  ),
}));
import { getEbook, getEbooksForWork, getRecentlyOpened, getWorkIdsWithEbooks } from "@/lib/ebooks/queries";

/*
 * SLN-490: the e-book catalogue, and the old e-book library's tables and
 * columns dropped behind guards (migrations 0075 and 0076).
 */
describe.skipIf(!url)("the e-book catalogue", () => {
  const c = client!;
  let journal: { entries: { tag: string }[] };
  let before: string;
  let after: string;

  /** A migrations folder that stops at this migration (exclusive), or holds all of them */
  async function folder(until?: string) {
    const dir = await mkdtemp(join(tmpdir(), "durtal-ebook-catalogue-"));
    await mkdir(join(dir, "meta"));
    const stop = until ? journal.entries.findIndex((e) => e.tag === until) : journal.entries.length;
    const entries = journal.entries.slice(0, stop);
    for (const entry of entries) await copyFile(`src/lib/db/migrations/${entry.tag}.sql`, join(dir, `${entry.tag}.sql`));
    await writeFile(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    return dir;
  }
  async function reset(to: string) {
    await c.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;");
    await migrate(testDb!, { migrationsFolder: to });
  }
  /** The message a migration stops with: the database's own, under the migrator's */
  const failure = async (to: string) => {
    let error = (await migrate(testDb!, { migrationsFolder: to }).then(
      () => null,
      (e: unknown) => e,
    )) as { message?: string; cause?: unknown } | null;
    while (error?.cause) error = error.cause as typeof error;
    return error?.message ?? null;
  };
  /** A book with one edition, and the digital location named the old way with a copy */
  async function oldLibrary() {
    const [work] = await c`insert into works(title, slug) values ('À rebours', 'a-rebours') returning id`;
    const [edition] = await c`insert into editions(work_id, title) values (${work.id}, 'À rebours') returning id`;
    const [place] = await c`insert into locations(name, type) values ('Calibre', 'digital') returning id`;
    const [copy] = await c`insert into instances(edition_id, location_id, format) values (${edition.id}, ${place.id}, 'epub') returning id`;
    return { work: work.id as string, edition: edition.id as string, place: place.id as string, copy: copy.id as string };
  }
  const tables = async () =>
    (await c`select tablename from pg_tables where schemaname = 'public' and tablename in ('ebooks', 'calibre_books') order by 1`).map((r) => r.tablename);

  beforeAll(async () => {
    journal = JSON.parse(await readFile("src/lib/db/migrations/meta/_journal.json", "utf8"));
    const guards = journal.entries.find((e) => e.tag.endsWith("_ebook_library_guards"));
    expect(guards, "the guard migration").toBeDefined();
    before = await folder(guards!.tag);
    after = await folder();
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  describe("the migration", () => {
    it("stops, changing nothing, while the old library holds anything", async () => {
      await reset(before);
      const old = await oldLibrary();
      // A book of the old library
      const [book] = await c`insert into calibre_books(calibre_id, title, path, work_id) values (42, 'À rebours', 'Huysmans/A rebours (42)', ${old.work}) returning id`;
      expect(await failure(after)).toBe(
        "calibre_books holds 1 rows; this migration expects none (live had none on 4 October 2026). Ask the coordinator.",
      );
      // A reading place in it
      await c`insert into reading_progress(calibre_book_id, progress_percent) values (${book.id}, 0.5)`;
      expect(await failure(after)).toBe(
        "reading_progress holds 1 rows; this migration expects none (live had none on 4 October 2026). Ask the coordinator.",
      );
      await c`delete from reading_progress`;
      await c`delete from calibre_books`;
      // A copy that links to it
      await c`update instances set calibre_url = 'http://localhost:8083/book/42' where id = ${old.copy}`;
      expect(await failure(after)).toBe(
        "1 copies have a calibre_id or calibre_url; this migration expects none (live had none on 4 October 2026). Ask the coordinator.",
      );
      await c`update instances set calibre_url = null`;
      // A cover of the old reader with image adjustments
      await c`insert into image_adjustments(asset_key, sources, settings) values ('gold/calibre/42/cover.jpg', '["/api/reader/42/cover"]', '{}')`;
      expect(await failure(after)).toBe(
        "1 image adjustments are for covers of the old reader; this migration expects none (live had none on 4 October 2026). Ask the coordinator.",
      );
      // Nothing changed on the way
      expect(await c`select name from locations where id = ${old.place}`).toEqual([{ name: "Calibre" }]);
      expect(await tables()).toEqual(["calibre_books"]);
    });

    it("renames the digital location in place, keeps its copies, and points the setting at it", async () => {
      await reset(before);
      const old = await oldLibrary();
      await c`insert into instances(edition_id, location_id, format) values (${old.edition}, ${old.place}, 'pdf')`;
      await migrate(testDb!, { migrationsFolder: after });
      expect(await tables()).toEqual(["ebooks"]);
      expect(await c`select id, name, type from locations order by name`).toEqual([{ id: old.place, name: "eBooks", type: "digital" }]);
      expect(await c`select count(*)::int as n from instances where location_id = ${old.place}`).toEqual([{ n: 2 }]);
      expect(await c`select ebook_location_id from app_settings`).toEqual([{ ebook_location_id: old.place }]);
      expect(
        await c`select column_name from information_schema.columns where table_name = 'instances' and column_name like 'calibre%'`,
      ).toEqual([]);
      // Running the migrations again changes nothing
      const snapshot = async () => [
        await c`select * from locations order by id`,
        await c`select * from instances order by id`,
        await c`select * from app_settings`,
      ];
      const first = await snapshot();
      await migrate(testDb!, { migrationsFolder: after });
      expect(await snapshot()).toEqual(first);
    });

    describe("with no digital location", () => {
      // Every migration on an empty schema: the setup, in a hook with its own limit, as the
      // tables below do; it took most of the test's 5 s on a slower machine (SLN-538)
      beforeAll(() => reset(after), 60000);
      it("makes the location on a database without one", async () => {
        const places = await c`select id, name, type from locations`;
        expect(places).toEqual([{ id: expect.any(String), name: "eBooks", type: "digital" }]);
        expect(await c`select ebook_location_id from app_settings`).toEqual([{ ebook_location_id: places[0].id }]);
      });
    });
  });

  describe("the tables", () => {
    let book: { work: string; edition: string; copy: string; place: string };
    beforeAll(async () => {
      await reset(after);
    });
    beforeEach(async () => {
      await c`truncate ebook_annotations, ebook_positions, ebook_files, ebooks, works, locations cascade`;
      const [place] = await c`insert into locations(name, type) values ('eBooks', 'digital') returning id`;
      const [work] = await c`insert into works(title, slug) values ('Là-bas', 'la-bas') returning id`;
      const [edition] = await c`insert into editions(work_id, title) values (${work.id}, 'Là-bas') returning id`;
      const [copy] = await c`insert into instances(edition_id, location_id, format) values (${edition.id}, ${place.id}, 'epub') returning id`;
      book = { work: work.id, edition: edition.id, copy: copy.id, place: place.id };
      queries.length = 0;
    });
    const ebook = async (fields: Record<string, unknown> = {}) => {
      const [row] = await c`insert into ebooks ${c({ title: "Là-bas", import_source: "folder", ...fields })} returning *`;
      return row;
    };
    const file = async (ebookId: string, n: number, fields: Record<string, unknown> = {}) => {
      const [row] = await c`insert into ebook_files ${c({
        ebook_id: ebookId,
        sha256: n.toString(16).padStart(64, "0"),
        format: "epub",
        size_bytes: 1000 * n,
        content_type: "application/epub+zip",
        s3_key: `files/${n}.epub`,
        status: "stored",
        ...fields,
      })} returning *`;
      return row;
    };

    it("keeps an e-book a copy of a book, and linked exactly when it has a copy", async () => {
      await ebook({ instance_id: book.copy, match_state: "linked" });
      // A copy of a film cannot exist: one is forced past the edition rule, and refused here
      const film = await c.begin(async (t) => {
        await t.unsafe("set local session_replication_role = replica");
        const [w] = await t.unsafe("insert into works(title, slug, kind, original_language) values ('Häxan', 'haxan', 'film', null) returning id");
        const [e] = await t.unsafe("insert into editions(work_id, title) values ($1, 'Häxan') returning id", [w.id]);
        const [i] = await t.unsafe("insert into instances(edition_id, location_id) values ($1, $2) returning id", [e.id, book.place]);
        return i.id as string;
      });
      await expect(ebook({ title: "Häxan", instance_id: film, match_state: "linked" })).rejects.toMatchObject({
        code: "23514",
        constraint_name: "ebook_book_instance",
        message: "An eBook can only be a copy of a book",
      });
      await expect(ebook({ match_state: "linked" })).rejects.toMatchObject({ constraint_name: "ebooks_linked_check" });
      const [second] = await c`insert into instances(edition_id, location_id) values (${book.edition}, ${book.place}) returning id`;
      await expect(ebook({ instance_id: second.id })).rejects.toMatchObject({ constraint_name: "ebooks_linked_check" });
      await expect(ebook({ match_state: "maybe" })).rejects.toMatchObject({ constraint_name: "ebooks_match_state_check" });
      // One sidecar identifier per source; the same one may come from an upload
      await ebook({ import_ref: "urn:uuid:1" });
      await expect(ebook({ import_ref: "urn:uuid:1" })).rejects.toMatchObject({ constraint_name: "ebooks_import_ref_unique" });
      await ebook({ import_ref: "urn:uuid:1", import_source: "upload" });
    });

    it("sends an e-book back to review, with its files, when its copy is removed", async () => {
      const linked = await ebook({ instance_id: book.copy, match_state: "linked", match_method: "isbn", match_probability: 0.98, matched_at: new Date().toISOString() });
      await file(linked.id, 1);
      await file(linked.id, 2, { format: "pdf", content_type: "application/pdf", s3_key: "files/2.pdf" });
      await c`delete from instances where id = ${book.copy}`;
      expect(await c`select instance_id, match_state, match_method, match_probability, matched_at from ebooks where id = ${linked.id}`).toEqual([
        { instance_id: null, match_state: "pending", match_method: null, match_probability: null, matched_at: null },
      ]);
      expect(await c`select count(*)::int as n from ebook_files where ebook_id = ${linked.id}`).toEqual([{ n: 2 }]);
      // A file of an e-book cannot go with it by accident
      await expect(c`delete from ebooks where id = ${linked.id}`).rejects.toMatchObject({ code: "23503" });
    });

    it("finds the works that have an e-book in one query, through active copies only", async () => {
      const works: string[] = [book.work];
      for (let n = 1; n < 48; n++) {
        const [w] = await c`insert into works(title, slug) values (${`Book ${n}`}, ${`book-${n}`}) returning id`;
        works.push(w.id);
      }
      await ebook({ instance_id: book.copy, match_state: "linked" });
      // An e-book of a copy that left the collection does not count
      const [gone] = await c`insert into editions(work_id, title) values (${works[1]}, 'Book 1') returning id`;
      const [old] = await c`insert into instances(edition_id, location_id, status) values (${gone.id}, ${book.place}, 'deaccessioned') returning id`;
      await ebook({ title: "Book 1", instance_id: old.id, match_state: "linked" });
      queries.length = 0;
      expect([...(await getWorkIdsWithEbooks(works))]).toEqual([book.work]);
      expect(queries).toHaveLength(1);
      expect(await getWorkIdsWithEbooks([])).toEqual(new Set());

      const [row] = await getEbooksForWork(book.work);
      expect(row).toMatchObject({ title: "Là-bas", instanceId: book.copy, matchState: "linked", files: [] });
      expect(await getEbooksForWork(works[1])).toEqual([]);
    });

    it("lists a text's files in the reader's order of preference", async () => {
      const text = await ebook();
      await file(text.id, 1, { format: "pdf", content_type: "application/pdf", s3_key: "files/1.pdf" });
      await file(text.id, 2, { format: "djvu", content_type: "image/vnd.djvu", s3_key: "files/2.djvu" });
      await file(text.id, 3);
      expect((await getEbook(text.id))!.files.map((f) => f.format)).toEqual(["epub", "pdf", "djvu"]);
      expect(await getEbook("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("gives the newest place of each e-book across devices, without excluded e-books", async () => {
      const a = await ebook({ title: "A" });
      const b = await ebook({ title: "B" });
      const hidden = await ebook({ title: "Hidden", match_state: "excluded" });
      const [fa, fb, fh] = [await file(a.id, 1), await file(b.id, 2), await file(hidden.id, 3)];
      const place = (ebookId: string, fileId: string, device: string, progression: number, at: string) =>
        c`insert into ebook_positions ${c({
          ebook_id: ebookId,
          file_id: fileId,
          device_id: device,
          device_label: device === "phone" ? "iPhone · Safari" : "Mac · Firefox",
          locator: JSON.stringify({ v: 1 }),
          progression,
          furthest_progression: progression,
          chapter: `Chapter at ${progression}`,
          client_updated_at: at,
          updated_at: at,
        })}`;
      await place(a.id, fa.id, "phone", 0.25, "2026-10-01T10:00:00Z");
      await place(a.id, fa.id, "mac", 0.5, "2026-10-03T10:00:00Z");
      await place(b.id, fb.id, "phone", 0.1234, "2026-10-02T10:00:00Z");
      await place(hidden.id, fh.id, "mac", 0.9, "2026-10-04T10:00:00Z");
      const recent = await getRecentlyOpened(10);
      expect(recent.map((r) => [r.title, r.percent, r.deviceLabel])).toEqual([
        ["A", 50, "Mac · Firefox"],
        ["B", 12.34, "iPhone · Safari"],
      ]);
      expect(recent[0].updatedAt).toEqual(new Date("2026-10-03T10:00:00Z"));
      expect(await getRecentlyOpened(1)).toHaveLength(1);
      await expect(place(a.id, fa.id, "watch", 1.2, "2026-10-05T10:00:00Z")).rejects.toMatchObject({
        constraint_name: "ebook_positions_progression_check",
      });
    });
  });
});
