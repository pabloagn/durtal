import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
const url = process.env.DURTAL_COLLECTION_MEDIA_MIGRATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln326_migration_test"
  )
    throw new Error(
      "Migration rehearsal requires disposable local sln326_migration_test",
    );
}
describe.skipIf(!url)("collection media migration", () => {
  it("moves collection artwork into media and changes nothing else", async () => {
    const c = postgres(url!, { max: 1, onnotice: () => {} });
    const db = drizzle(c);
    const folder = await mkdtemp(join(tmpdir(), "durtal-collection-media-"));
    try {
      await c.unsafe(
        "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;",
      );
      const journal = JSON.parse(
        await readFile("src/lib/db/migrations/meta/_journal.json", "utf8"),
      );
      journal.entries = journal.entries.filter(
        (entry: { idx: number }) => entry.idx <= 28,
      );
      await mkdir(join(folder, "meta"));
      await writeFile(
        join(folder, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      for (const entry of journal.entries)
        await copyFile(
          `src/lib/db/migrations/${entry.tag}.sql`,
          join(folder, `${entry.tag}.sql`),
        );
      await migrate(db, { migrationsFolder: folder });

      const [work] =
        await c`insert into works(title) values ('Book') returning *`;
      const [author] =
        await c`insert into authors(name) values ('Author') returning *`;
      const [workPoster] =
        await c`insert into media(work_id,type,s3_key,crop_x) values (${work.id},'poster','work.webp',30) returning *`;
      const [authorPoster] =
        await c`insert into media(author_id,type,s3_key) values (${author.id},'poster','author.webp') returning *`;
      const [full] =
        await c`insert into collections(name,poster_s3_key,poster_thumbnail_s3_key,background_s3_key,cover_s3_key)
        values ('Full','p.webp','p_thumb.webp','bg.webp','legacy.webp') returning *`;
      const [legacyOnly] =
        await c`insert into collections(name,cover_s3_key) values ('Legacy','only.webp') returning *`;
      const [sameCover] =
        await c`insert into collections(name,poster_s3_key,cover_s3_key) values ('Same','same.webp','same.webp') returning *`;
      const [bare] =
        await c`insert into collections(name,description) values ('Bare','kept') returning *`;
      await c`insert into image_adjustments(asset_key,sources,settings) values ('p.webp','["/api/s3/read?key=p.webp"]','{"brightness":120,"contrast":90}')`;

      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });

      const rows =
        await c`select collection_id,type,s3_key,thumbnail_s3_key,is_active,brightness,contrast from media where collection_id is not null order by collection_id,type,is_active desc`;
      const of = (id: string) =>
        rows
          .filter((r) => r.collection_id === id)
          .map(
            ({
              type,
              s3_key,
              thumbnail_s3_key,
              is_active,
              brightness,
              contrast,
            }) => ({
              type,
              s3_key,
              thumbnail_s3_key,
              is_active,
              brightness,
              contrast,
            }),
          );
      expect(of(full.id)).toEqual([
        {
          type: "background",
          s3_key: "bg.webp",
          thumbnail_s3_key: null,
          is_active: true,
          brightness: 100,
          contrast: 100,
        },
        {
          type: "poster",
          s3_key: "p.webp",
          thumbnail_s3_key: "p_thumb.webp",
          is_active: true,
          brightness: 120,
          contrast: 90,
        },
        {
          type: "poster",
          s3_key: "legacy.webp",
          thumbnail_s3_key: null,
          is_active: false,
          brightness: 100,
          contrast: 100,
        },
      ]);
      expect(of(legacyOnly.id)).toEqual([
        {
          type: "poster",
          s3_key: "only.webp",
          thumbnail_s3_key: null,
          is_active: true,
          brightness: 100,
          contrast: 100,
        },
      ]);
      expect(of(sameCover.id)).toHaveLength(1);
      expect(of(bare.id)).toEqual([]);

      // Old columns are gone; names and descriptions survive.
      const columns =
        await c`select column_name from information_schema.columns where table_name='collections' order by column_name`;
      expect(columns.map((r) => r.column_name)).toEqual([
        "created_at",
        "description",
        "id",
        "name",
        "sort_order",
        "updated_at",
      ]);
      expect(
        (
          await c`select name,description from collections where id=${bare.id}`
        )[0],
      ).toEqual({ name: "Bare", description: "kept" });

      // Work and author media are untouched.
      expect(
        (await c`select * from media where id=${workPoster.id}`)[0],
      ).toEqual({ ...workPoster, collection_id: null });
      expect(
        (await c`select * from media where id=${authorPoster.id}`)[0],
      ).toEqual({ ...authorPoster, collection_id: null });

      // The adjustment record stays keyed by the same S3 key.
      expect(
        (await c`select asset_key from image_adjustments`).map(
          (r) => r.asset_key,
        ),
      ).toEqual(["p.webp"]);

      // Owner rule: exactly one owner.
      await expect(
        c`insert into media(type,s3_key) values ('poster','none.webp')`,
      ).rejects.toThrow();
      await expect(
        c`insert into media(work_id,collection_id,type,s3_key) values (${work.id},${bare.id},'poster','two.webp')`,
      ).rejects.toThrow();

      // Deleting a collection removes its media rows.
      await c`delete from collections where id=${full.id}`;
      expect(
        await c`select 1 from media where collection_id=${full.id}`,
      ).toHaveLength(0);

      // Re-running is a no-op.
      const before = await c`select count(*)::int as n from media`;
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
      expect(await c`select count(*)::int as n from media`).toEqual(before);
    } finally {
      await c.end();
      await rm(folder, { recursive: true, force: true });
    }
  }, 30000);
});
