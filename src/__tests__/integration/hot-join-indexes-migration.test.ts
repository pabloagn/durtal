import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { requireDisposableDatabaseUrl } from "./helpers/disposable-database";

const url = process.env.DURTAL_HOT_JOIN_INDEXES_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln935_hot_join_indexes");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln935_hot_join_indexes")
    throw new Error("Hot join index tests require disposable local sln935_hot_join_indexes");
}

const lookups = [
  ["work_authors", "author_id"],
  ["edition_contributors", "author_id"],
  ["edition_tags", "tag_id"],
  ["work_subjects", "subject_id"],
  ["custom_taxonomy_item_works", "work_id"],
  ["work_art_movements", "art_movement_id"],
] as const;

describe.skipIf(!url)("hot join index migration", () => {
  it("upgrades a populated catalogue with valid non-unique indexes and preserves its rows", async () => {
    const client = postgres(url!, { max: 1, onnotice: () => {}, prepare: false });
    const db = drizzle(client);
    const folder = await mkdtemp(join(tmpdir(), "durtal-hot-join-indexes-"));
    try {
      await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
      const journal = JSON.parse(await readFile("src/lib/db/migrations/meta/_journal.json", "utf8")) as {
        entries: { idx: number; tag: string }[];
      };
      expect(journal.entries.some((entry) => entry.idx === 90)).toBe(true);
      journal.entries = journal.entries.filter((entry) => entry.idx < 90);
      expect(journal.entries.at(-1)?.idx).toBe(89);
      await mkdir(join(folder, "meta"));
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries)
        await copyFile(`src/lib/db/migrations/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
      await migrate(db, { migrationsFolder: folder });

      const [person] = await client`insert into authors (name) values ('Index migration person') returning id`;
      const books = await client`insert into works (title) values ('First indexed book'), ('Second indexed book') returning id`;
      const [subject] = await client`insert into subjects (name, slug) values ('Index subject', 'index-subject') returning id`;
      const [tag] = await client`insert into tags (name, slug) values ('Index tag', 'index-tag') returning id`;
      const [movement] = await client`insert into art_movements (name, slug) values ('Index movement', 'index-movement') returning id`;
      const paintings = await client`insert into works (kind, title, original_language, catalogue_status)
        values ('painting', 'First index painting', null, 'tracked'),
          ('painting', 'Second index painting', null, 'tracked') returning id`;
      const [family] = await client`insert into taxonomy_families (name, slug) values ('Index family', 'index-family') returning id`;
      const items = await client`insert into custom_taxonomy_items (family_id, name, slug)
        values (${family.id}, 'First index item', 'first-index-item'), (${family.id}, 'Second index item', 'second-index-item') returning id`;
      for (const book of books) {
        await client`insert into work_authors (work_id, author_id) values (${book.id}, ${person.id})`;
        const [edition] = await client`insert into editions (work_id, title) values (${book.id}, 'Index migration edition') returning id`;
        await client`insert into edition_contributors (edition_id, author_id, role) values (${edition.id}, ${person.id}, 'editor')`;
        await client`insert into work_subjects (work_id, subject_id) values (${book.id}, ${subject.id})`;
        await client`insert into edition_tags (edition_id, tag_id) values (${edition.id}, ${tag.id})`;
        for (const item of items)
          await client`insert into custom_taxonomy_item_works (item_id, work_id) values (${item.id}, ${book.id})`;
      }
      for (const painting of paintings)
        await client`insert into work_art_movements (work_id, art_movement_id) values (${painting.id}, ${movement.id})`;
      const rows = async () => Object.fromEntries(await Promise.all(lookups.map(async ([table]) => [
        table,
        await client`select to_jsonb(t) as row from ${client(table)} t order by to_jsonb(t)::text`,
      ])));
      const before = await rows();
      for (const [table] of lookups) expect(before[table].length, table).toBeGreaterThanOrEqual(2);
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });

      for (const [table, column] of lookups) {
        const indexes = await client`
          select i.indisvalid, i.indisready, i.indisunique, i.indpred is null as unconditional,
            am.amname as method, a.attname as leading_column
          from pg_index i
          join pg_class t on t.oid = i.indrelid
          join pg_namespace n on n.oid = t.relnamespace
          join pg_class ix on ix.oid = i.indexrelid
          join pg_am am on am.oid = ix.relam
          join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
          where n.nspname = 'public' and t.relname = ${table}
        `;
        expect(indexes, `${table}.${column}`).toContainEqual({
          indisvalid: true, indisready: true, indisunique: false,
          unconditional: true, method: "btree", leading_column: column,
        });
      }
      expect(await rows()).toEqual(before);
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
      expect(await rows()).toEqual(before);
    } finally {
      await client.end({ timeout: 5 });
      await rm(folder, { recursive: true, force: true });
    }
  }, 30000);
});
