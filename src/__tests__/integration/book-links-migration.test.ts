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
const url = process.env.DURTAL_LINKS_MIGRATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln322_migration_test"
  )
    throw new Error(
      "Migration rehearsal requires disposable local sln322_migration_test",
    );
}
describe.skipIf(!url)("book links migration", () => {
  it("upgrades a populated 0027 catalogue, adds empty links and changes nothing else", async () => {
    const c = postgres(url!, { max: 1, onnotice: () => {} });
    const db = drizzle(c);
    const folder = await mkdtemp(join(tmpdir(), "durtal-link-migrations-"));
    try {
      await c.unsafe(
        "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;",
      );
      const journal = JSON.parse(
        await readFile("src/lib/db/migrations/meta/_journal.json", "utf8"),
      );
      journal.entries = journal.entries.filter(
        (entry: { idx: number }) => entry.idx <= 27,
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
        await c`insert into works(title,original_year,notes,rating,catalogue_status,acquisition_priority,is_rare,hunt_assessed_on) values ('Fictions',1944,'Keep me',5,'wanted','urgent',true,'2026-09-25') returning *`;
      const [edition] =
        await c`insert into editions(work_id,title,isbn_13) values (${work.id},'Fictions','9780141183022') returning *`;

      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
      const [after] = await c`select * from works`;
      expect(after).toEqual({
        ...work,
        goodreads_url: null,
        storygraph_url: null,
      });
      expect((await c`select * from editions`)[0]).toEqual(edition);

      // Re-running is a no-op.
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
      expect((await c`select * from works`)[0]).toEqual(after);
    } finally {
      await c.end();
      await rm(folder, { recursive: true, force: true });
    }
  }, 20000);
});
