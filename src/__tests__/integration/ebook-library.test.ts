import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import {
  ebookFileDownloadableCondition,
  ebookFileNativeReadableCondition,
  isEbookFileDownloadable,
  isEbookFileNativeReadable,
  type EbookFileEligibility,
} from "@/lib/ebooks/conditions";
import { ebookFileKey } from "@/lib/ebooks/keys";
import {
  malformedPublicationCases,
  publicationFixture,
} from "../ebooks/publication-fixture";
import { parseEbookLibraryParams } from "@/lib/ebooks/library-params";
import { setPreferredFile } from "@/lib/ebooks/preferred-file";
import { getLinkedBook } from "@/lib/ebooks/linked-book";
import {
  ebookLibraryPageQuery,
  getEbooksPage,
  getEbookLibraryCounts,
  getEbookDetail,
  getContinueReading,
} from "@/lib/ebooks/library-queries";

// Added to the local harness manifest automatically. Never connect outside its disposable database.
const url = process.env.DURTAL_EBOOK_LIBRARY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln497_ebook_library"
  )
    throw new Error(
      "E-book library tests require disposable local sln497_ebook_library",
    );
}
const client = url ? postgres(url, { prepare: false, max: 1, onnotice: () => {} }) : null;
const database = client ? drizzle(client) : null;
const columns = {
  status: sql`f.status`,
  drm: sql`f.drm`,
  s3Key: sql`f.s3_key`,
  sha256: sql`f.sha256`,
  sizeBytes: sql`f.size_bytes`,
  manifestKey: sql`f.manifest_key`,
  format: sql`f.format`,
  metadata: sql`f.metadata`,
};

describe.skipIf(!url)(
  "e-book library SQL/TypeScript eligibility parity",
  () => {
    beforeAll(async () => {
      await migrate(database!, { migrationsFolder: "src/lib/db/migrations" });
    }, 60000);
    afterAll(async () => {
      await client?.end();
    });
    afterEach(() => vi.unstubAllEnvs());

    async function parity(file: EbookFileEligibility) {
      const [row] = await database!.execute(sql`select
      ${ebookFileDownloadableCondition(columns)} as downloadable,
      ${ebookFileNativeReadableCondition(columns)} as readable
      from (select ${file.status}::text as status, ${file.drm}::text as drm,
        ${file.s3Key}::text as s3_key, ${file.sha256}::text as sha256, ${file.format}::text as format,
        ${file.sizeBytes}::numeric as size_bytes, ${file.manifestKey ?? null}::text as manifest_key,
        ${JSON.stringify(file.metadata === undefined ? {} : file.metadata)}::jsonb as metadata) f`);
      expect(row.downloadable, JSON.stringify(file)).toBe(
        isEbookFileDownloadable(file),
      );
      expect(row.readable, JSON.stringify(file)).toBe(
        isEbookFileNativeReadable(file),
      );
    }

    it("compares valid, rejected, legacy and malformed publication cases in real PostgreSQL", async () => {
      const base = publicationFixture();
      const sha = base.sha256;
      const m = base.metadata.medallion;
      const cases: EbookFileEligibility[] = [
        base,
        ...malformedPublicationCases(),
        { ...base, status: "verified" },
        ...["missing", "quarantined", "replaced", "pending"].map((status) => ({
          ...base,
          status,
        })),
        ...["adobe-adept", ""].map((drm) => ({ ...base, drm })),
        { ...base, metadata: {} },
        { ...base, metadata: undefined },
        {
          ...base,
          metadata: {
            medallion: {
              ...m,
              validation: { ...m.validation, nativeReadable: false },
            },
          },
        },
        { ...base, sha256: "invalid" },
        { ...base, format: "pdf" },
        { ...base, s3Key: base.s3Key.replace("gold/", "bronze/") },
        { ...base, s3Key: ebookFileKey(sha, "epub"), metadata: undefined },
        {
          ...base,
          s3Key: ebookFileKey(sha, "epub"),
          metadata: { medallion: null },
        },
        {
          ...base,
          format: "txt",
          s3Key: ebookFileKey(sha, "txt"),
          metadata: {},
        },
      ];
      for (const file of cases) await parity(file);
      vi.stubEnv("EBOOKS_PREFIX", "legacy/");
      await parity({
        ...base,
        s3Key: ebookFileKey(sha, "epub"),
        metadata: undefined,
      });
      await parity(base);
    });
    it("pages, combines filters and searches normalized title/author/series on the actual query", async () => {
      await client!`insert into ebooks(title, authors, author_sort, language, match_state, exclusion_reason, import_source, search_text)
        values ('The Waves', array['Virginia Woolf'], 'Woolf', 'en', 'pending', null, 'folder', 'the waves virginia woolf'),
          ('Les Misérables', array['Victor Hugo'], 'Hugo', 'fr', 'standalone', null, 'folder', 'les miserables victor hugo'),
          ('Nadja', array['André Breton'], 'Breton', 'fr', 'pending', null, 'folder', 'nadja andre breton surrealism'),
          ('Set aside', array['Another'], 'Another', 'de', 'excluded', 'duplicate', 'folder', 'set aside another')`;
      const [nadja] =
        await client!`select id from ebooks where title = 'Nadja'`;
      const body = Buffer.from("A real text fixture.");
      const checksum = createHash("sha256").update(body).digest("hex");
      await client!`insert into ebook_files(ebook_id, sha256, s3_key, format, size_bytes, content_type, status, drm)
        values (${nadja.id}, ${checksum}, ${ebookFileKey(checksum, "txt")}, 'txt', ${body.length}, 'text/plain; charset=utf-8', 'stored', 'unknown')`;
      const [excluded] =
        await client!`select id from ebooks where title = 'Set aside'`;
      const pdf = readFileSync("src/__tests__/fixtures/ebooks/text.pdf");
      const pdfHash = createHash("sha256").update(pdf).digest("hex");
      await client!`insert into ebook_files(ebook_id, sha256, s3_key, format, size_bytes, content_type, status)
        values (${excluded.id}, ${pdfHash}, ${ebookFileKey(pdfHash, "pdf")}, 'pdf', ${pdf.length}, 'application/pdf', 'stored')`;
      const page = await getEbooksPage(
        parseEbookLibraryParams({
          language: "fr",
          linked: "unlinked",
          format: "txt",
          drm: "yes",
        }),
        database!,
      );
      expect(page.map((book) => book.title)).toEqual(["Nadja"]);
      for (const q of [
        "nadja",
        "André Breton",
        "surrealism",
        "miserables",
        "nadj",
      ]) {
        expect(
          (await getEbooksPage(parseEbookLibraryParams({ q }), database!))
            .length,
          q,
        ).toBeGreaterThan(0);
      }
      // A linked e-book is found by its book's title and author too (SLN-683)
      const [work] = await client!`insert into works(title, slug, original_title) values ('Against Nature', 'against-nature', 'À rebours') returning id`;
      const [author] = await client!`insert into authors(name, slug) values ('Joris-Karl Huysmans', 'joris-karl-huysmans') returning id`;
      await client!`insert into work_authors(work_id, author_id) values (${work.id}, ${author.id})`;
      const [edition] = await client!`insert into editions(work_id, title) values (${work.id}, 'Against Nature') returning id`;
      const [shelf] = await client!`insert into locations(name, type) values ('eBooks', 'digital') returning id`;
      const [copy] = await client!`insert into instances(edition_id, location_id, format) values (${edition.id}, ${shelf.id}, 'epub') returning id`;
      await client!`insert into ebooks(title, authors, author_sort, language, match_state, instance_id, import_source, search_text)
        values ('The Distant Orchard', array['Fixture'], 'Fixture', 'en', 'linked', ${copy.id}, 'folder', 'the distant orchard fixture')`;
      for (const q of ["against nature", "a rebours", "huysmans"])
        expect(
          (await getEbooksPage(parseEbookLibraryParams({ q }), database!)).map((book) => book.title),
          q,
        ).toEqual(["The Distant Orchard"]);
      await client!`update ebooks set match_state = 'standalone', instance_id = null where title = 'The Distant Orchard'`;
      expect((await getEbooksPage(parseEbookLibraryParams({ q: "huysmans" }), database!)).length).toBe(0);
      await client!`delete from ebooks where title = 'The Distant Orchard'`;
      expect(
        (await getEbooksPage(parseEbookLibraryParams({}), database!)).some(
          (book) => book.matchState === "excluded",
        ),
      ).toBe(false);
      expect(
        (
          await getEbooksPage(
            parseEbookLibraryParams({ state: "excluded" }),
            database!,
          )
        ).map((book) => book.title),
      ).toContain("Set aside");
      const counts = await getEbookLibraryCounts(
        parseEbookLibraryParams({ q: "nadja" }),
        database!,
      );
      expect(counts.total).toBe(1);
      expect(counts.review).toBe(2);
      expect(counts.excluded).toBe(1);
      expect(counts.languages).not.toContain("de");
      expect(counts.formats).not.toContain("pdf");
      const excludedCounts = await getEbookLibraryCounts(
        parseEbookLibraryParams({ state: "excluded" }),
        database!,
      );
      expect(excludedCounts.languages).toEqual(["de"]);
      expect(excludedCounts.formats).toEqual(["pdf"]);
    });
    it("continues only books being read, by their book's title and authors (SLN-683)", async () => {
      const [work] = await client!`insert into works(title, slug) values ('Là-bas', 'la-bas') returning id`;
      const [author] = await client!`insert into authors(name, slug) values ('J.-K. Huysmans', 'j-k-huysmans') returning id`;
      await client!`insert into work_authors(work_id, author_id) values (${work.id}, ${author.id})`;
      const [edition] = await client!`insert into editions(work_id, title) values (${work.id}, 'Là-bas') returning id`;
      const [shelf] = await client!`insert into locations(name, type) values ('eBooks', 'digital') returning id`;
      const [copy] = await client!`insert into instances(edition_id, location_id, format) values (${edition.id}, ${shelf.id}, 'epub') returning id`;
      const [ebook] = await client!`insert into ebooks(title, authors, match_state, instance_id, import_source, search_text)
        values ('Down There', array['Fixture'], 'linked', ${copy.id}, 'folder', 'down there') returning id`;
      const bytes = readFileSync("src/__tests__/fixtures/ebooks/epub3.epub");
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const [file] = await client!`insert into ebook_files(ebook_id, sha256, s3_key, format, size_bytes, content_type, status)
        values (${ebook.id}, ${checksum}, ${ebookFileKey(checksum, "epub")}, 'epub', ${bytes.length}, 'application/epub+zip', 'stored') returning id`;
      const device = randomUUID();
      const place = async (sectionIndex: number, progression: number, totalProgression: number, on = device, when = "now()") => {
        const locator = { v: 1, fileHash: checksum, href: "chapter", sectionIndex, progression, totalProgression };
        await client!`insert into ebook_positions(ebook_id, file_id, device_id, device_label, locator, progression, furthest_progression, chapter, client_updated_at)
          values (${ebook.id}, ${file.id}, ${on}, 'Mac', ${JSON.stringify(locator)}, ${totalProgression}, ${totalProgression}, null, ${client!.unsafe(when)})
          on conflict (file_id, device_id) do update set locator = excluded.locator, progression = excluded.progression,
            client_updated_at = excluded.client_updated_at`;
        return (await getContinueReading(device, database!)).find((item) => item.ebook.id === ebook.id);
      };
      // Only opened: the first page of the first section
      expect(await place(0, 0, 0.03)).toBeUndefined();
      // Being read on another device: this device only opening it does not hide that place
      const phone = randomUUID();
      const elsewhere = await place(2, 0.5, 0.4, phone, "now() - interval '1 day'");
      expect(elsewhere?.descriptor.anchor?.deviceId).toBe(phone);
      expect(elsewhere?.descriptor.savedPercent).toBe(40);
      // Twelve books opened since are not "continue", and do not push it out
      for (let i = 0; i < 12; i++) {
        const sha = createHash("sha256").update(`opened ${i}`).digest("hex");
        const [opened] = await client!`insert into ebooks(title, import_source, search_text)
          values (${`Opened ${i}`}, 'folder', ${`opened ${i}`}) returning id`;
        const [openedFile] = await client!`insert into ebook_files(ebook_id, sha256, s3_key, format, size_bytes, content_type, status)
          values (${opened.id}, ${sha}, ${ebookFileKey(sha, "epub")}, 'epub', ${bytes.length}, 'application/epub+zip', 'stored') returning id`;
        await client!`insert into ebook_positions(ebook_id, file_id, device_id, device_label, locator, progression, furthest_progression, chapter, client_updated_at)
          values (${opened.id}, ${openedFile.id}, ${device}, 'Mac', ${JSON.stringify({ v: 1, fileHash: sha, href: "cover", sectionIndex: 0, progression: 0, totalProgression: 0.02 })}, 0.02, 0.02, null, now())`;
      }
      const continuing = await getContinueReading(device, database!);
      expect(continuing.some((item) => item.ebook.title.startsWith("Opened "))).toBe(false);
      expect(continuing.find((item) => item.ebook.id === ebook.id)?.descriptor.anchor?.deviceId).toBe(phone);
      await client!`delete from ebook_positions where ebook_id = ${ebook.id} and device_id = ${phone}`;
      const reading = await place(1, 0.4, 0.5);
      expect(reading?.bookTitle).toBe("Là-bas");
      expect(reading?.bookAuthors).toEqual(["J.-K. Huysmans"]);
      // Finished
      expect(await place(3, 1, 1)).toBeUndefined();
    });
    it("keeps a replaced-file anchor intact while selecting a current native target", async () => {
      const [ebook] =
        await client!`insert into ebooks(title, import_source, search_text) values ('Historical places', 'folder', 'historical places') returning id`;
      const oldBytes = readFileSync(
        "src/__tests__/fixtures/ebooks/nav-pagelist.epub",
      );
      const currentBytes = readFileSync(
        "src/__tests__/fixtures/ebooks/nav-pagemap.epub",
      );
      const files = [];
      for (const [bytes, status] of [
        [oldBytes, "replaced"],
        [currentBytes, "stored"],
      ] as const) {
        const checksum = createHash("sha256").update(bytes).digest("hex");
        const [file] =
          await client!`insert into ebook_files(ebook_id, sha256, s3_key, format, size_bytes, content_type, status)
          values (${ebook.id}, ${checksum}, ${ebookFileKey(checksum, "epub")}, 'epub', ${bytes.length}, 'application/epub+zip', ${status}) returning id`;
        files.push({ id: String(file.id), checksum });
      }
      await client!`update ebooks set preferred_file_id = ${files[1].id} where id = ${ebook.id}`;
      const original = {
        v: 1,
        fileHash: files[0].checksum,
        href: "chapter",
        sectionIndex: 0,
        progression: 0.2,
        totalProgression: 0.44,
        cfi: "epubcfi(original)",
        text: { before: "before", highlight: "Saved passage", after: "after" },
      };
      const device = randomUUID();
      await client!`insert into ebook_positions(ebook_id, file_id, device_id, device_label, locator, progression, furthest_progression, chapter, client_updated_at)
        values (${ebook.id}, ${files[0].id}, ${device}, 'Mac', ${JSON.stringify(original)}, 0.44, 0.44, 'Chapter I', '2026-10-09T10:00:00Z')`;
      const item = (await getContinueReading(device, database!)).find(
        (item) => item.ebook.id === ebook.id,
      )!;
      expect(item.descriptor.target.id).toBe(files[1].id);
      expect(item.descriptor.anchor?.locator).toEqual(original);
      expect(item.descriptor.projection).toBe("pending-reanchor");
      expect(item.descriptor.targetPercent).toBeNull();
      expect(item.descriptor.href).toBe(
        `/reader/${ebook.id}?file=${files[1].id}`,
      );
      const detail = await getEbookDetail(String(ebook.id), database!);
      expect(detail?.files).toHaveLength(2);
      expect(detail?.positions[0].locator).toEqual(original);
      await expect(
        setPreferredFile(
          { ebookId: String(ebook.id), fileId: files[0].id },
          database!,
        ),
      ).rejects.toThrow("no longer be opened");
      expect(
        await setPreferredFile(
          { ebookId: String(ebook.id), fileId: files[1].id },
          database!,
        ),
      ).toMatchObject({ preferredFileId: files[1].id });
      const [other] =
        await client!`insert into ebooks(title, import_source) values ('Other book', 'folder') returning id`;
      await expect(
        setPreferredFile(
          { ebookId: String(other.id), fileId: files[1].id },
          database!,
        ),
      ).rejects.toThrow("no longer be opened");
      for (const status of ["missing", "quarantined"]) {
        await client!`update ebook_files set status = ${status} where id = ${files[1].id}`;
        await expect(
          setPreferredFile(
            { ebookId: String(ebook.id), fileId: files[1].id },
            database!,
          ),
        ).rejects.toThrow("no longer be opened");
      }
      await client!`update ebook_files set status = 'stored', drm = 'adobe-adept' where id = ${files[1].id}`;
      await expect(
        setPreferredFile(
          { ebookId: String(ebook.id), fileId: files[1].id },
          database!,
        ),
      ).rejects.toThrow("no longer be opened");
      await client!`update ebook_files set drm = null where id = ${files[1].id}`;
      await client!`update ebooks set match_state = 'excluded', exclusion_reason = 'duplicate' where id = ${ebook.id}`;
      await client!`update ebooks set exclusion_reason = 'duplicate' where id = ${ebook.id}`;
      expect((await getEbookDetail(String(ebook.id), database!))?.exclusionReason).toBe("duplicate");
      await expect(
        setPreferredFile(
          { ebookId: String(ebook.id), fileId: files[1].id },
          database!,
        ),
      ).rejects.toThrow("no longer be opened");
    });
    it("uses natural database keys and an index-backed bounded page at 7000 rows", async () => {
      await client!`insert into ebooks(title, authors, language, import_source, search_text)
        select 'Book ' || n, array['Scale Author'], 'en', 'folder', 'book ' || n || ' scale author' from generate_series(1,7000) n`;
      await client!`analyze ebooks`;
      const params = parseEbookLibraryParams({
        q: "book",
        perPage: "48",
        sort: "title",
      });
      const page = await getEbooksPage(params, database!);
      expect(page).toHaveLength(48);
      expect(page.slice(0, 3).map((book) => book.title)).toEqual([
        "Book 1",
        "Book 2",
        "Book 3",
      ]);
      const natural =
        await client!`select ebook_title_sort('Book 2','en') < ebook_title_sort('Book 10','en') as numeric,
        ebook_title_sort('The Waves','en') = ebook_title_sort('Waves','en') as english,
        ebook_title_sort('Les Misérables','fr') = ebook_title_sort('Miserables','fr') as french`;
      expect(natural[0]).toMatchObject({
        numeric: true,
        english: true,
        french: true,
      });
      const plan = await database!.execute(
        sql`explain (format json) ${ebookLibraryPageQuery(parseEbookLibraryParams({ perPage: "48" }))}`,
      );
      expect(JSON.stringify(plan)).toMatch(
        /ebooks_active_title_sort_idx|ebooks_state_title_sort_idx/,
      );
    }, 30000);
    it("shows the linked book's cover: the e-book edition's, else the poster, else the book's first edition with one (SLN-666)", async () => {
      const [work] = await client!`insert into works(title) values ('Linked cover book') returning id`;
      const [shelf] = await client!`insert into locations(name, type) values ('eBooks', 'digital') returning id`;
      await client!`insert into editions(work_id, title, cover_s3_key, created_at)
        values (${work.id}, 'Hardback', 'gold/covers/hardback.webp', now() - interval '1 year')`;
      const [digital] = await client!`insert into editions(work_id, title) values (${work.id}, 'eBook') returning id`;
      const [copy] = await client!`insert into instances(edition_id, location_id) values (${digital.id}, ${shelf.id}) returning id`;
      const cover = async () => (await getLinkedBook(copy.id, database!))?.coverUrl;
      expect(await cover()).toContain("hardback.webp");
      await client!`insert into media(work_id, type, s3_key) values (${work.id}, 'poster', 'gold/media/poster.webp')`;
      expect(await cover()).toContain("poster.webp");
      await client!`update editions set cover_s3_key = 'gold/covers/digital.webp' where id = ${digital.id}`;
      expect(await cover()).toContain("digital.webp");
    });
  },
);
