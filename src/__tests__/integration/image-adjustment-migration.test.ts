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
const url = process.env.DURTAL_IMAGE_MIGRATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln316_migration_test"
  )
    throw new Error(
      "Migration rehearsal requires disposable local sln316_migration_test",
    );
}
describe.skipIf(!url)("image adjustment migration", () => {
  it("upgrades a populated 0026 catalogue without changing existing rows or image defaults", async () => {
    const c = postgres(url!, { max: 1, onnotice: () => {} });
    const db = drizzle(c);
    const folder = await mkdtemp(join(tmpdir(), "durtal-image-migrations-"));
    try {
      await c.unsafe(
        "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;",
      );
      const journal = JSON.parse(
        await readFile("src/lib/db/migrations/meta/_journal.json", "utf8"),
      );
      journal.entries = journal.entries.filter(
        (entry: { idx: number }) => entry.idx <= 26,
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
        await c`insert into works(title,is_rare,hunt_assessed_on) values ('Existing book',true,'2024-02-29') returning *`;
      const [author] =
        await c`insert into authors(name,photo_s3_key) values ('Existing author','portrait.jpg') returning *`;
      const [media] =
        await c`insert into media(author_id,type,s3_key,original_s3_key,brightness,contrast,crop_x,crop_y,crop_zoom,processing_params) values (${author.id},'poster','portrait.jpg','color-original.jpg',115,125,35,65,140,'{"grayscale":true,"gamma":2.2}') returning *`;
      const [edition] =
        await c`insert into editions(work_id,title,cover_s3_key) values (${work.id},'Existing edition','cover.jpg') returning *`;
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
      expect((await c`select * from works`)[0]).toEqual(work);
      expect((await c`select * from authors`)[0]).toEqual(author);
      expect((await c`select * from media`)[0]).toEqual(media);
      expect((await c`select * from editions`)[0]).toEqual(edition);
      expect(await c`select * from image_adjustments`).toHaveLength(0);
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
      expect(await c`select * from image_adjustments`).toHaveLength(0);
    } finally {
      await c.end();
      await rm(folder, { recursive: true, force: true });
    }
  }, 20000);
});
