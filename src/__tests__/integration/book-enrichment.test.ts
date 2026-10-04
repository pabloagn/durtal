import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import { planEdition } from "@/lib/books/enrichment";
import {
  applyEditionPlan,
  assessBookMetadata,
  loadEnrichableEditions,
  undoEnrichment,
} from "@/lib/books/enrichment-store";
import { sourcePayloadHash } from "@/lib/publishers/enrichment";
import type { MatchCandidate } from "@/lib/match/plan";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_BOOK_ENRICHMENT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln414_test"
  )
    throw new Error("Book enrichment tests require disposable local sln414_test");
}
const sql = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;

const DESCRIPTION =
  "Three brothers, a murdered father and a trial: Dostoevsky's last novel argues with itself about faith, freedom and guilt.";
const record = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  title: "The Brothers Karamazov",
  subtitle: null,
  publisher: "Farrar, Straus and Giroux",
  isbn13: "9780374528379",
  isbn10: "0374528373",
  publicationYear: 2002,
  pageCount: 796,
  language: "en",
  binding: "paperback",
  description: DESCRIPTION,
  coverUrl: "https://images.isbndb.com/covers/x.jpg",
  ...over,
});

describe.skipIf(!url)("book enrichment with PostgreSQL", () => {
  const db = sql!;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    // drizzle swaps its client's json serializers, so it migrates on its own
    // client: the suite then writes through a bare one, as the script does
    const migrator = postgres(url!, { max: 1, onnotice: () => {} });
    await migrate(drizzle(migrator, { schema }), { migrationsFolder: "src/lib/db/migrations" });
    await migrator.end();
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await db`truncate works cascade`;
    const [work] = await db`insert into works (title, original_year) values ('The Brothers Karamazov', 1880) returning id`;
    ids.work = work.id;
    const editions = await db`insert into editions
        (work_id, title, isbn_13, isbn_10, publisher, language, cover_s3_key, thumbnail_s3_key, cover_source_url, metadata_source, metadata_locked)
      values
        (${work.id}, 'The Brothers Karamazov', '9780374528379', '0374528373', 'Farrar, Straus and Giroux', 'en', 'covers/k.jpg', 'covers/k-t.jpg', 'https://example.com/k.jpg', 'isbndb', false),
        (${work.id}, 'The Brothers Karamazov', '9780140449242', null, null, 'en', null, null, null, 'isbndb', true),
        (${work.id}, 'The Brothers Karamazov', null, null, null, 'en', null, null, null, 'phantom_canon', false)
      returning id, metadata_locked, metadata_source`;
    ids.edition = editions[0].id;
    ids.locked = editions[1].id;
    ids.placeholder = editions[2].id;
  });

  it("reads only unlocked, non-placeholder editions with an ISBN and an empty field", async () => {
    const rows = await loadEnrichableEditions(db);
    expect(rows.map((r) => r.id)).toEqual([ids.edition]);
    expect(rows[0]).toMatchObject({ workOriginalYear: 1880, workDescription: null });
  });

  it("fills only the plan's empty columns, keeps covers, ISBNs and publisher links, and records provenance", async () => {
    const links = await db`select * from edition_publishers where edition_id = ${ids.edition}`;
    const [row] = await loadEnrichableEditions(db);
    const plan = planEdition(row, { isbndb: record(), open_library: record({ pageCount: 780 }) });
    const retrievedAt = new Date();
    const written = await db.begin((tx) =>
      applyEditionPlan(tx as unknown as postgres.Sql, plan, { runId: "run-1", retrievedAt, isbn: "9780374528379" }),
    );
    expect(written.map((w) => `${w.table}.${w.column}`)).toEqual([
      "editions.description",
      "editions.page_count",
      "editions.publication_year",
      "editions.binding",
      "works.description",
    ]);
    const [after] = await db`select * from editions where id = ${ids.edition}`;
    expect(after).toMatchObject({
      description: DESCRIPTION,
      page_count: 780,
      publication_year: 2002,
      binding: "paperback",
      // Never touched
      isbn_13: "9780374528379",
      isbn_10: "0374528373",
      publisher: "Farrar, Straus and Giroux",
      cover_s3_key: "covers/k.jpg",
      thumbnail_s3_key: "covers/k-t.jpg",
      cover_source_url: "https://example.com/k.jpg",
    });
    expect(await db`select * from edition_publishers where edition_id = ${ids.edition}`).toEqual(links);
    const [work] = await db`select description from works where id = ${ids.work}`;
    expect(work.description).toBe(DESCRIPTION);
    const sources = await db`select provider, entity_kind, edition_id, review_status, payload, payload_hash,
        jsonb_typeof(payload) as payload_type
      from source_records order by provider`;
    expect(sources.map((s) => s.provider)).toEqual(["isbndb", "open_library"]);
    for (const s of sources) {
      expect(s).toMatchObject({
        entity_kind: "edition",
        edition_id: ids.edition,
        review_status: "accepted",
        payload_type: "object",
      });
      expect(typeof s.payload).toBe("object");
      expect(s.payload_hash).toBe(sourcePayloadHash(s.payload));
      expect(s.payload.runId).toBe("run-1");
    }
    // Both sources agree on every field; the page count is the lower of the two
    expect(sources[0].payload.fields).toMatchObject({ page_count: 780, publication_year: 2002 });
    expect(sources[1].payload.fields).toEqual({
      description: DESCRIPTION,
      page_count: 780,
      publication_year: 2002,
      binding: "paperback",
    });
  });

  it("leaves a column someone filled since the plan, and undo clears only its own values", async () => {
    const [row] = await loadEnrichableEditions(db);
    const plan = planEdition(row, { isbndb: record() });
    await db`update editions set page_count = 812 where id = ${ids.edition}`;
    const written = await db.begin((tx) =>
      applyEditionPlan(tx as unknown as postgres.Sql, plan, { runId: "run-2", retrievedAt: new Date(), isbn: "9780374528379" }),
    );
    expect(written.map((w) => w.column)).not.toContain("page_count");
    await db`update editions set binding = 'hardcover' where id = ${ids.edition}`;
    const restored = await db.begin((tx) => undoEnrichment(tx as unknown as postgres.Sql, { runId: "run-2", written }));
    expect(restored).toBe(written.length - 1);
    const [after] = await db`select description, page_count, publication_year, binding from editions where id = ${ids.edition}`;
    expect(after).toEqual({ description: null, page_count: 812, publication_year: null, binding: "hardcover" });
    const [work] = await db`select description from works where id = ${ids.work}`;
    expect(work.description).toBeNull();
    expect(await db`select id from source_records`).toEqual([]);
  });

  it("assesses the holes read-only and finds an original year that is an edition year", async () => {
    await db`update works set original_year = 2002 where id = ${ids.work}`;
    await db`update editions set publication_year = 2002 where id = ${ids.edition}`;
    const result = await db.begin("read only", (tx) => assessBookMetadata(tx as unknown as postgres.Sql));
    expect(result.counts).toMatchObject({
      editions: 3,
      locked: 1,
      placeholders: 1,
      without_isbn: 1,
      no_description: 3,
      no_pages: 3,
      works: 1,
      works_no_description: 1,
    });
    expect(result.suspectYears).toEqual([
      expect.objectContaining({ title: "The Brothers Karamazov", original_year: 2002, years: [2002] }),
    ]);
    await expect(db.begin("read only", (tx) => (tx as unknown as postgres.Sql)`update works set original_year = 1880`)).rejects.toThrow();
  });
});
