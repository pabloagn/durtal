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

const url = process.env.DURTAL_PUBLISHER_MIGRATION_TEST_DATABASE_URL;
if (url) {
  const p = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(p.hostname) ||
    p.pathname !== "/sln319_migration_test"
  )
    throw new Error(
      "Migration rehearsal requires disposable local sln319_migration_test",
    );
}

describe.skipIf(!url)("publisher migration rehearsal", () => {
  it("upgrades a populated 0024 catalogue without altering books, copies, source text or rare flags", async () => {
    const c = postgres(url!, { max: 1, onnotice: () => {} });
    const db = drizzle(c);
    const folder = await mkdtemp(
      join(tmpdir(), "durtal-publisher-migrations-"),
    );
    try {
      // This database is dedicated to this test; the URL guard rejects every live host.
      await c.unsafe(
        "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;",
      );
      const journal = JSON.parse(
        await readFile("src/lib/db/migrations/meta/_journal.json", "utf8"),
      );
      journal.entries = journal.entries.filter(
        (e: { idx: number }) => e.idx <= 24,
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
      const [p] =
        await c`insert into publishing_houses(name,slug,country) values ('NYRB','nyrb','United States') returning *`;
      const [w] =
        await c`insert into works(title,slug,rating,is_rare,hunt_assessed_on,catalogue_status,notes) values ('Existing book','existing-book',5,true,'2024-02-29','accessioned','Keep my notes') returning *`;
      const [e] =
        await c`insert into editions(work_id,title,publisher,imprint,language,metadata_locked,cover_s3_key) values (${w.id},'Existing edition','  NYRB  ','Unknown imprint','es',true,'gold/covers/existing.jpg') returning *`;
      const [unresolved] =
        await c`insert into editions(work_id,title,publisher) values (${w.id},'Unmatched edition','Unknown house') returning *`;
      const [l] =
        await c`insert into locations(name,type) values ('Existing shelf','physical') returning id`;
      const [copy] =
        await c`insert into instances(edition_id,location_id,notes) values (${e.id},${l.id},'Keep copy notes') returning *`;
      const [order] =
        await c`insert into orders(work_id,edition_id,acquisition_method,order_date,status) values (${w.id},${e.id},'gift','2024-02-29','received') returning *`;
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
      // Later migrations may add work columns; every existing value must survive.
      expect((await c`select * from works where id=${w.id}`)[0]).toMatchObject(w);
      expect((await c`select * from instances where id=${copy.id}`)[0]).toEqual(
        copy,
      );
      expect((await c`select * from editions where id=${e.id}`)[0]).toEqual({
        ...e,
        publisher_links_confirmed: false,
      });
      expect(
        (await c`select * from editions where id=${unresolved.id}`)[0],
      ).toEqual({ ...unresolved, publisher_links_confirmed: false });
      expect((await c`select * from orders where id=${order.id}`)[0]).toEqual({
        ...order,
        acquisition_target_id: null,
      });
      expect(
        (await c`select * from publishing_houses where id=${p.id}`)[0],
      ).toEqual({
        ...p,
        kind: "publisher",
        parent_id: null,
        is_favourite: false,
        notes: null,
      });
      expect([...(await c`select * from edition_publishers`)]).toEqual([
        { edition_id: e.id, publisher_id: p.id },
      ]);
      // Running the migrator again must be a no-op.
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
      expect(
        (await c`select count(*)::int as count from edition_publishers`)[0]
          .count,
      ).toBe(1);
    } finally {
      await c.end();
      await rm(folder, { recursive: true, force: true });
    }
  }, 20000);
});
