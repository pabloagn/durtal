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
import { DOMAIN_TAXONOMIES } from "@/lib/catalogue/taxonomies";

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

/** The last migration applied to the live database. */
const LIVE_MIGRATION = "0036_publisher_hierarchy";

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

  // Explicitly reconcile additive shared-person schema changes; never omit a
  // legacy field or relationship from the preservation comparison.
  function legacyRows(snapshot: Record<string, Record<string, unknown>[]>) {
    const projected = structuredClone(snapshot);
    for (const work of projected.works) {
      delete work.kind;
      if ("is_favourite" in work) {
        expect(work.is_favourite).toBe(false);
        delete work.is_favourite;
      }
    }
    // Migration 0062 adds a house's founding year and city, empty for every row
    for (const row of projected.publishing_houses ?? [])
      for (const column of ["founded_year", "founded_place_id"])
        if (column in row) {
          expect(row[column], column).toBeNull();
          delete row[column];
        }
    // Migration 0061 stars nothing: every new favourite starts off
    for (const table of ["authors", "collections", "series", "recommenders"])
      for (const row of projected[table] ?? []) {
        if ("is_favourite" in row) {
          expect(row.is_favourite, table).toBe(false);
          delete row.is_favourite;
        }
      }
    if (projected.taxonomy_applicability) {
      for (const definition of DOMAIN_TAXONOMIES) {
        const family = projected.taxonomy_families.find(
          (row) => row.slug === definition.slug,
        )!;
        expect(family).toMatchObject({
          name: definition.name,
          is_system: true,
          system_table: "custom_taxonomy_items",
          hierarchical: definition.hierarchical,
        });
        for (const level of definition.levels)
          expect(projected.taxonomy_applicability).toContainEqual({
            family_id: family.id,
            kind: definition.kind,
            level,
          });
      }
      projected.taxonomy_families = projected.taxonomy_families.filter(
        (row) =>
          !DOMAIN_TAXONOMIES.some((definition) => definition.slug === row.slug),
      );
    }
    for (const table of ["publishing_houses", "publisher_aliases", "venues"])
      for (const row of projected[table]) {
        if ("search_text" in row) {
          expect(row.search_text).toEqual(expect.any(String));
          delete row.search_text;
        }
      }
    for (const table of ["work_authors", "edition_contributors"])
      for (const credit of projected[table]) {
        if ("id" in credit) {
          expect(credit.id).toEqual(expect.any(String));
          expect(credit.credited_as).toBeNull();
          expect(credit.attribution).toBe("unspecified");
          delete credit.id;
          delete credit.credited_as;
          delete credit.attribution;
        }
      }
    for (const row of projected.media)
      for (const column of ["organization_id", "art_object_id", "perfume_variant_id", "alt_text", "credit", "license", "license_url", "source_url", "source_record_id"])
        if (column in row) {
          expect(row[column], column).toBeNull();
          delete row[column];
        }
    for (const row of projected.venues) {
      if ("archived_at" in row) { expect(row.archived_at).toBeNull(); delete row.archived_at; }
    }
    // 0064 (SLN-444): works.rating becomes numeric(2,1); a stored 4 reads as
    // the number 4 either way, so only its type is checked
    for (const row of projected.works ?? [])
      if (row.rating != null) expect(typeof row.rating, "works.rating").toBe("number");
    // 0052 adds the one settings row with today's defaults. This catalogue has
    // no Amsterdam or Mexico City, so new copies get no default location.
    if (projected.app_settings)
      expect(projected.app_settings).toEqual([
        expect.objectContaining({
          id: true,
          new_book_status: "tracked",
          new_book_language: "en",
          new_copy_location_id: null,
          new_copy_format: "paperback",
          new_copy_condition: "mint",
          home_currency: "EUR",
        }),
      ]);
    for (const table of [
      "app_settings",
      "credit_roles",
      "person_domains",
      "person_aliases",
      "work_credits",
      "organization_roles",
      "organization_venues",
      "taxonomy_applicability",
      "catalogue_dates",
      "catalogue_identifiers",
      "source_records",
      "perfume_details",
      "perfume_variants",
      "perfume_organizations",
      "perfume_notes",
      "perfume_variant_notes",
      "perfume_variant_overrides",
      "perfume_variant_taxa",
      "perfume_bottles",
      "perfume_variant_perfumers",
      "perfume_retailer_links",
      "perfume_retailer_observations",
      "film_details",
      "film_countries",
      "film_languages",
      "film_organizations",
      "film_versions",
      "film_releases",
      "film_holdings",
      "painting_details",
      "art_objects",
      "art_object_credits",
      "art_object_taxa",
      "art_object_whereabouts",
      "work_relations",
      "collection_works",
      "readings",
      "reading_sessions",
      "reading_status_history",
    ])
      delete projected[table];
    // Added UUID columns change PostgreSQL's JSON ordering; compare canonical
    // legacy rows rather than accidentally requiring the new random IDs to sort.
    for (const rows of Object.values(projected))
      rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return projected;
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
    // Start from the schema that is live today; every later migration is an
    // expansion that must preserve the populated catalogue.
    const live = journal.entries.findIndex(
      (entry: { tag: string }) => entry.tag === LIVE_MIGRATION,
    );
    expect(live).toBeGreaterThan(0);
    const expansionEntries = journal.entries.slice(live + 1);
    journal.entries = journal.entries.slice(0, live + 1);
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
    await c`update works set metadata_source='Historic provider / mixed', metadata_source_id='raw:work/42' where id=${bookId}`;
    await c`update authors set metadata_source='wikidata', metadata_source_id='Q42' where id=${author.id}`;
    await c`insert into work_authors(work_id,author_id,role,sort_order) values (${bookId},${author.id},'author',3)`;
    await c`insert into work_authors(work_id,author_id,role,sort_order) values (${bookId},${author.id},'historical collaborator',4)`;
    const [edition] = await c`
      insert into editions(work_id,title,isbn_13,language,cover_s3_key)
      values (${bookId},'On Painting','9780141183022','en','gold/covers/keep.webp') returning id
    `;
    const [translation] = await c`
      insert into editions(work_id,title,language,notes) values (${bookId},'De la peinture','fr','Translation') returning id
    `;
    await c`update editions set metadata_source='openlibrary',metadata_last_fetched='2026-01-01T00:00:00Z',metadata_locked=true where id=${edition.id}`;
    await c`insert into edition_contributors(edition_id,author_id,role,sort_order) values (${translation.id},${author.id},'translator',1)`;
    await c`insert into edition_contributors(edition_id,author_id,role,sort_order) values (${translation.id},${author.id},'historical annotator',2)`;
    const [customFamily] =
      await c`insert into taxonomy_families(name,slug,entity_level,hierarchical) values ('Legacy mood','legacy-mood','work',true) returning id`;
    const [customItem] =
      await c`insert into custom_taxonomy_items(family_id,name,slug) values (${customFamily.id},'Reflective','reflective') returning id`;
    await c`insert into custom_taxonomy_item_works values (${customItem.id},${bookId})`;
    // Historical custom usage can span both stores despite one declared level.
    await c`insert into custom_taxonomy_item_editions values (${customItem.id},${edition.id})`;
    const [theme] =
      await c`insert into themes(name,slug,level) values ('Art','art',1) returning id`;
    const [childTheme] =
      await c`insert into themes(name,slug,level,parent_id) values ('Perspective','perspective',2,${theme.id}) returning id`;
    await c`insert into work_themes values (${bookId},${childTheme.id})`;
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
    const [venue] = await c`
      insert into venues(name,slug,type,formatted_address,personal_rating,first_visit_date,last_visit_date,tags)
      values ('Historic Bookshop','historic-bookshop','bookshop','1 Rue de la Paix',4,'2020-01-01','2026-09-20',ARRAY['antiquarian']) returning id
    `;
    await c`
      insert into orders(work_id,edition_id,instance_id,venue_id,acquisition_method,status,order_date,price,currency)
      values (${bookId},${edition.id},${copy.id},${venue.id},'in_store_purchase','received','2026-09-20',25.50,'EUR')
    `;
    await c`
      insert into harmonization_redirects(source_id,entity,source_slug,target_id)
      values ('11111111-1111-4111-8111-111111111111','works','old-book-slug',${bookId})
    `;
    before = legacyRows(await snapshot());
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
      if (entry.tag.endsWith("_reading_rating_precheck")) {
        // A rating outside 1 to 5 stops the migration with its title, changing nothing
        const [odd] =
          await c`insert into works(title,slug,rating) values ('Nadja','nadja-precheck',0) returning id`;
        const worksBefore = await c`select id, rating from works order by id`;
        const failure = await migrate(db!, { migrationsFolder: folder }).then(
          () => null,
          (error) => error,
        );
        expect(String((failure?.cause ?? failure)?.message)).toMatch(
          new RegExp(`^Ratings outside 1 to 5; ask Joris before migrating: ${odd.id} Nadja \\(rating 0\\)`),
        );
        expect(await c`select id, rating from works order by id`).toEqual(worksBefore);
        await c`delete from works where id=${odd.id}`;
      }
      if (entry.tag === "0045_venues_retailer_observations") {
        // Legacy writes skipped validation: stop with a clear error, change nothing.
        const [invalid] =
          await c`insert into venues(name,slug,type,personal_rating) values ('Unrated','unrated','other',0) returning id`;
        const failure = await migrate(db!, { migrationsFolder: folder }).then(
          () => null,
          (error) => error,
        );
        expect(String((failure?.cause ?? failure)?.message)).toMatch(
          /^Resolve existing venues/,
        );
        const [{ table }] =
          await c`select to_regclass('public.perfume_retailer_links') as table`;
        expect(table).toBeNull();
        await c`delete from venues where id=${invalid.id}`;
      }
      await migrate(db!, { migrationsFolder: folder });
      const fullStep = await snapshot();
      expect(fullStep.works.every((work) => work.kind === "book")).toBe(true);
      if (fullStep.taxonomy_applicability) {
        expect(fullStep.taxonomy_applicability).toEqual(
          expect.arrayContaining([
            { family_id: customFamily.id, kind: "book", level: "work" },
            { family_id: customFamily.id, kind: "book", level: "edition" },
          ]),
        );
      }
      if (fullStep.person_domains) {
        expect(fullStep.person_domains).toHaveLength(before.authors.length);
        for (const author of before.authors)
          expect(fullStep.person_domains).toContainEqual({
            person_id: author.id,
            kind: "book",
          });
        for (const [table, level] of [
          ["work_authors", "work"],
          ["edition_contributors", "edition"],
        ])
          for (const credit of before[table])
            expect(fullStep.credit_roles).toContainEqual(
              expect.objectContaining({
                kind: "book",
                level,
                legacy_role: credit.role,
              }),
            );
        expect(fullStep.person_aliases).toEqual([]);
        expect(fullStep.work_credits).toEqual([]);
      }
      const afterStep = legacyRows(fullStep);
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
    expect(reconciled).toContain("0037_work_kinds");
    expect(reconciled).toContain("0038_book_boundaries");
    const after = await snapshot();
    expect(after.works).toHaveLength(1);
    expect(after.works[0].kind).toBe("book");
    expect(legacyRows(after)).toEqual(before);
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
        await c`insert into works(title,kind,original_language) values ('Readiness probe',${kind},${kind === "book" ? "en" : null})`;
        accepted.push(kind);
      } catch (error) {
        expect(error).toMatchObject({
          code: "23514",
          constraint_name: "works_kind_enabled_check",
        });
      }
    }
    // The same kinds; the enum and the menus list them in different orders
    expect([...accepted].sort()).toEqual([...getEnabledWorkKinds()].sort());
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
    // The dropped gate came back with the rollback
    expect(
      await c`select 1 from pg_constraint where conname = 'works_kind_enabled_check'`,
    ).toHaveLength(1);
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
