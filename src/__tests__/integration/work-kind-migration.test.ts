import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
import { WORK_KINDS } from "@/lib/catalogue/kinds";

// Destructive migration rehearsal: explicitly opt in to this local database.
// Never fall back to DATABASE_URL or load application environment files.
const url = process.env.DURTAL_WORK_KIND_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln346_migration_test"
  )
    throw new Error(
      "Work-kind tests require disposable local sln346_migration_test",
    );
}

describe.skipIf(!url)("work-kind migration on a populated catalogue", () => {
  const client = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
  const c = client!;
  const db = client ? drizzle(client) : null;
  let folder: string | undefined;
  let before: Record<string, Record<string, unknown>[]>;
  let bookId: string;
  const reconciled: string[] = [];
  const reconciliation: {
    migration: string;
    tableCount: number;
    rowCount: number;
    preservedSha256: string;
  }[] = [];

  async function snapshot() {
    const tables = await c<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' order by tablename
    `;
    const result: Record<string, Record<string, unknown>[]> = {};
    for (const { tablename } of tables) {
      const rows =
        await c`select to_jsonb(r) as row from ${c(tablename)} r order by to_jsonb(r)::text`;
      result[tablename] = rows.map((r) => r.row);
    }
    return result;
  }

  beforeAll(async () => {
    await c.unsafe(
      "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;",
    );
    folder = await mkdtemp(join(tmpdir(), "durtal-work-kind-migration-"));
    await mkdir(join(folder, "meta"));
    const journal = JSON.parse(
      await readFile("src/lib/db/migrations/meta/_journal.json", "utf8"),
    );
    const expansionEntries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx > 32,
    );
    journal.entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx <= 32,
    );
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries) {
      await copyFile(
        `src/lib/db/migrations/${entry.tag}.sql`,
        join(folder, `${entry.tag}.sql`),
      );
    }
    await migrate(db!, { migrationsFolder: folder });

    const [type] =
      await c`insert into work_types(name,slug) values ('Painting','painting') returning id`;
    const [author] =
      await c`insert into authors(name,slug,bio) values ('Test Author','test-author','Preserved biography') returning id`;
    const [series] =
      await c`insert into series(title,slug) values ('Essays','essays') returning id`;
    const [book] = await c`
      insert into works(title,slug,original_language,original_year,description,notes,rating,
        catalogue_status,acquisition_priority,is_rare,hunt_assessed_on,is_poison,
        goodreads_url,storygraph_url,work_type_id,series_id,series_position)
      values ('On Painting','on-painting-by-test-author','it',1435,'Keep description','Keep notes',5,
        'wanted','urgent',true,'2026-09-25',true,
        'https://www.goodreads.com/book/show/1','https://app.thestorygraph.com/books/example',
        ${type.id},${series.id},'2') returning id
    `;
    bookId = book.id;
    await c`insert into work_authors(work_id,author_id,role,sort_order) values (${bookId},${author.id},'author',3)`;
    const [edition] = await c`
      insert into editions(work_id,title,isbn_13,language,cover_s3_key)
      values (${bookId},'On Painting','9780141183022','en','gold/covers/keep.webp') returning id
    `;
    const [translation] = await c`
      insert into editions(work_id,title,language,notes) values (${bookId},'De la peinture','fr','Translation') returning id
    `;
    await c`insert into edition_contributors(edition_id,author_id,role,sort_order) values (${translation.id},${author.id},'translator',1)`;
    const [location] =
      await c`insert into locations(name,type) values ('Study','physical') returning id`;
    const [digital] =
      await c`insert into locations(name,type) values ('Calibre','digital') returning id`;
    const [copy] = await c`
      insert into instances(edition_id,location_id,format,acquisition_price,acquisition_currency)
      values (${edition.id},${location.id},'hardcover',25.50,'EUR') returning id
    `;
    await c`insert into instances(edition_id,location_id,format,calibre_id) values (${translation.id},${digital.id},'epub',73)`;
    const [publisher] =
      await c`insert into publishing_houses(name,slug) values ('Test Press','test-press') returning id`;
    await c`insert into publisher_aliases(publisher_id,name) values (${publisher.id},'Press alias')`;
    const [imprint] = await c`
      insert into publishing_houses(name,slug,kind,parent_id)
      values ('Essays Imprint','essays-imprint','imprint',${publisher.id}) returning id
    `;
    await c`select set_edition_publishers(${edition.id}, ARRAY[${publisher.id}::uuid])`;
    await c`select set_edition_publishers(${translation.id}, ARRAY[${imprint.id}::uuid])`;
    const [target] =
      await c`insert into acquisition_targets(work_id,publisher_id) values (${bookId},${publisher.id}) returning id`;
    await c`insert into acquisition_target_copies(target_id,instance_id) values (${target.id},${copy.id})`;
    await c`insert into calibre_books(calibre_id,title,path,work_id) values (73,'De la peinture','Calibre/De la peinture',${bookId})`;
    await c`insert into work_status_history(work_id,to_status,notes) values (${bookId},'wanted','Keep status history')`;
    const [art] =
      await c`insert into art_types(name,slug) values ('Painting','painting') returning id`;
    await c`insert into work_art_types(work_id,art_type_id) values (${bookId},${art.id})`;
    const [movement] =
      await c`insert into art_movements(name,slug) values ('Renaissance','renaissance') returning id`;
    await c`insert into work_art_movements(work_id,art_movement_id) values (${bookId},${movement.id})`;
    const [collection] =
      await c`insert into collections(name,icon) values ('Art books','Palette') returning id`;
    await c`insert into collection_editions(collection_id,edition_id,sort_order) values (${collection.id},${translation.id},7)`;
    await c`insert into media(work_id,type,s3_key,thumbnail_s3_key,crop_x) values (${bookId},'poster','gold/media/keep.webp','gold/media/keep-thumb.webp',28)`;
    await c`insert into comments(entity_type,entity_id,content_html) values ('work',${bookId},'<p>Keep commentary</p>')`;
    await c`insert into activity_events(entity_type,entity_id,event_key,metadata) values ('work',${bookId},'work.created','{}')`;
    await c`
      insert into orders(work_id,edition_id,instance_id,acquisition_method,status,order_date,price,currency)
      values (${bookId},${edition.id},${copy.id},'in_store_purchase','received','2026-09-20',25.50,'EUR')
    `;
    await c`
      insert into harmonization_redirects(source_id,entity,source_slug,target_id)
      values ('11111111-1111-4111-8111-111111111111','works','old-book-slug',${bookId})
    `;
    before = await snapshot();
    // Apply and reconcile each expansion migration independently. A later step
    // cannot hide a destructive intermediate change by recreating the data.
    for (const entry of expansionEntries) {
      journal.entries.push(entry);
      await copyFile(
        `src/lib/db/migrations/${entry.tag}.sql`,
        join(folder, `${entry.tag}.sql`),
      );
      await writeFile(
        join(folder, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      await migrate(db!, { migrationsFolder: folder });
      const afterStep = await snapshot();
      expect(afterStep.works.every((work) => work.kind === "book")).toBe(true);
      for (const work of afterStep.works) delete work.kind;
      expect(afterStep, `Preserved catalogue after ${entry.tag}`).toEqual(
        before,
      );
      reconciled.push(entry.tag);
      reconciliation.push({
        migration: entry.tag,
        tableCount: Object.keys(before).length,
        rowCount: Object.values(before).reduce(
          (sum, rows) => sum + rows.length,
          0,
        ),
        preservedSha256: createHash("sha256")
          .update(JSON.stringify(afterStep))
          .digest("hex"),
      });
    }
    const reportDir = process.env.DURTAL_TEST_REPORT_DIR;
    if (reportDir)
      await writeFile(
        join(reportDir, "migration-reconciliation.json"),
        JSON.stringify(reconciliation, null, 2) + "\n",
      );
  }, 30000);

  afterAll(async () => {
    await client?.end();
    if (folder) await rm(folder, { recursive: true, force: true });
  });

  it("preserves every existing row and classifies art-tagged books as books", async () => {
    expect(reconciled).toContain("0033_work_kinds");
    expect(reconciled).toContain("0034_book_boundaries");
    const after = await snapshot();
    expect(after.works).toHaveLength(1);
    expect(after.works[0].kind).toBe("book");
    delete after.works[0].kind;
    expect(after).toEqual(before);
  });

  it("keeps legacy SQL inserts working with the book default", async () => {
    const [row] =
      await c`insert into works(title) values ('Legacy import') returning kind`;
    expect(row.kind).toBe("book");
  });

  it("registers all explicit kinds but enables only the ready domain", async () => {
    const types = await c`
      select enumlabel from pg_enum join pg_type on pg_type.oid = enumtypid
      where typname = 'work_kind_enum' order by enumsortorder
    `;
    expect(types.map((r) => r.enumlabel)).toEqual([...WORK_KINDS]);
    const accepted: string[] = [];
    for (const kind of WORK_KINDS) {
      try {
        await c`insert into works(title,kind) values ('Readiness probe',${kind})`;
        accepted.push(kind);
      } catch (error) {
        expect(error).toMatchObject({
          code: "23514",
          constraint_name: "works_kind_enabled_check",
        });
      }
    }
    expect(accepted).toEqual(getEnabledWorkKinds());
  });

  it("rejects unknown and null identities at the database boundary", async () => {
    await expect(
      c`insert into works(title,kind) values ('Invalid','novel')`,
    ).rejects.toMatchObject({ code: "22P02" });
    await expect(
      c`insert into works(title,kind) values ('Invalid',null)`,
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("makes identity immutable even after a future activation widens the gate", async () => {
    // The expected error rolls back the dropped check along with the update.
    await expect(
      c.begin(async (tx) => {
        await tx.unsafe(
          "alter table works drop constraint works_kind_enabled_check",
        );
        await tx.unsafe("update works set kind = 'painting' where id = $1", [
          bookId,
        ]);
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "works_kind_immutable",
    });
    const [row] = await c`select kind from works where id = ${bookId}`;
    expect(row.kind).toBe("book");
    await expect(
      c`insert into works(title,kind) values ('Still disabled','painting')`,
    ).rejects.toMatchObject({ constraint_name: "works_kind_enabled_check" });
  });

  it("allows ordinary updates and redundant SQL assignment of the same kind", async () => {
    const [row] = await c`
      update works set kind = 'book', notes = 'Updated note' where id = ${bookId}
      returning kind,notes,original_language,catalogue_status,acquisition_priority
    `;
    expect(row).toEqual({
      kind: "book",
      notes: "Updated note",
      original_language: "it",
      catalogue_status: "wanted",
      acquisition_priority: "urgent",
    });
  });

  it("can reapply the migration runner without modifying data", async () => {
    const once = await snapshot();
    await migrate(db!, { migrationsFolder: "src/lib/db/migrations" });
    expect(await snapshot()).toEqual(once);
  });
});
