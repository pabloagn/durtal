import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const store = vi.hoisted(() => ({ books: vi.fn(), targets: vi.fn(), digital: vi.fn(), sql: vi.fn() }));
vi.mock("@/lib/ebooks/work-availability", () => ({ getWorkDigitalAvailability: store.digital }));
vi.mock("@/lib/db", () => ({
  db: { query: { works: { findMany: store.books } }, execute: store.sql },
}));
vi.mock("@/lib/actions/publishers", () => ({
  getAcquisitionTargetsForExport: store.targets,
}));
vi.mock("@/lib/utils/date", () => ({ todayLocal: () => "2026-10-09" }));
vi.mock("@/lib/export/reading", () => ({
  READING_EXPORT_COLUMNS: [],
  SESSION_EXPORT_COLUMNS: [],
  NOTE_EXPORT_COLUMNS: [],
  commonplaceNotes: vi.fn(),
  loadGoodreadsBooks: vi.fn(),
  noteExportRows: vi.fn(),
  readingExportRows: vi.fn(),
  sessionExportRows: vi.fn(),
}));
vi.mock("@/lib/export/collections", () => ({
  COLLECTION_EXPORTS: {
    films: "film",
    perfumes: "perfume",
    paintings: "painting",
  },
  collectionExportRows: vi.fn(),
}));
vi.mock("@/lib/reading/journal", () => ({ journalReadingIds: vi.fn() }));
vi.mock("@/lib/export/goodreads", () => ({ goodreadsRow: vi.fn() }));
vi.mock("@/lib/export/commonplace", () => ({ commonplaceMarkdown: vi.fn() }));

import { POST } from "@/app/api/export/route";
import { exportFormatsFor } from "@/lib/export/formats";

const id = "11111111-1111-1111-1111-111111111111";
const book = {
  id,
  title: "À rebours",
  workAuthors: [],
  editions: [],
  originalLanguage: "fr",
  originalYear: 1884,
  catalogueStatus: "wanted",
  acquisitionPriority: "high",
  rating: 4.5,
  isAnthology: false,
  notes: "=a formula-like note\nA second line",
  metadata: { secret: "private" },
  coverS3Key: "gold/media/private.webp",
  ebooks: [
    { s3Key: "gold/ebooks/private.epub", url: "https://private.example" },
  ],
};
const request = (body: unknown) =>
  new NextRequest("http://localhost/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  store.books.mockResolvedValue([book]);
  store.targets.mockResolvedValue([]);
  store.digital.mockResolvedValue(new Map());
  store.sql.mockResolvedValue([]);
});

describe("additive book JSON export", () => {
  it("exports selected allowlisted rows with original text, numbers and attachment metadata", async () => {
    const response = await POST(
      request({ entity: "works", ids: [id], format: "json" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="durtal-a-rebours-2026-10-09.json"',
    );
    const text = await response.text();
    const [row] = JSON.parse(text);
    expect(row).toMatchObject({
      title: "À rebours",
      original_year: 1884,
      rating: 4.5,
      is_anthology: false,
      notes: book.notes,
      catalogue_status: "wanted",
      instance_count: 0,
      // Nested data stays data, a missing value is null (SLN-894)
      acquisition_targets: [],
      edition_publishers: [],
      ebook_formats: [],
      isbn_13: null,
      page_count: null,
    });
    expect(text).not.toMatch(/gold\/|private|coverS3Key|metadata|https:\/\//);
    expect(store.books).toHaveBeenCalledOnce();
    expect(store.targets).toHaveBeenCalledWith([id]);
  });

  it("retains all-book selection and distinguishes native empty catalogues from unknown IDs", async () => {
    const response = await POST(
      request({ entity: "works", all: true, format: "json" }),
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="durtal-books-all-2026-10-09.json"',
    );
    store.books.mockResolvedValue([]);
    expect(
      (await POST(request({ entity: "works", all: true, format: "json" })))
        .status,
    ).toBe(200);
    expect((await POST(request({ entity: "works", ids: [id], format: "json" }))).status).toBe(404);
    expect((await POST(request({ entity: "works", all: true, format: "csv" }))).status).toBe(404);
  });

  it("exports the eligible format union from one position-free availability batch", async () => {
    const notes = "The reader target: readerPath /reader/notes, locator, editionId.";
    store.books.mockResolvedValue([{ ...book, notes }]);
    const available = (ebookId: string, formats: string[], readable: boolean) => ({
      ebookId, title: book.title, editionId: "edition", editionLanguage: "fr", editionYear: 1884,
      formats, continue: readable ? { href: `/reader/${ebookId}`, target: { id: "file" } } : null,
    });
    store.digital.mockResolvedValue(new Map([[id, { ebooks: [
      available("22222222-2222-2222-2222-222222222222", ["pdf", "epub"], true),
      available("33333333-3333-3333-3333-333333333333", ["epub"], true),
      available("44444444-4444-4444-4444-444444444444", ["cbr"], false),
    ], read: null }]]));
    const response = await POST(request({ entity: "works", ids: [id], format: "json" }));
    const [row] = await response.json();
    expect(row.ebook_formats).toEqual(["EPUB", "PDF"]);
    expect(store.digital).toHaveBeenCalledExactlyOnceWith([id], { includePositions: false });
    expect(row.acquisition_targets).toEqual([]);
    expect(row.notes).toBe(notes);
    for (const field of [
      "readerPath", "reader_path", "continue", "target", "targetFile", "editionId",
      "ebookId", "ebook_id", "fileId", "file_id", "files", "positions", "locator",
      "anchor", "localAnchor", "newestOtherAnchor", "savedPercent", "targetPercent",
      "s3Key", "s3_key", "sha256", "manifestKey", "manifest_key", "metadata",
      "sourcePath", "source_path", "sourceHost", "source_host", "url", "deliveryUrl",
    ]) {
      expect(row).not.toHaveProperty(field);
    }
  });

  it("allowlists native targets and uses SQL microseconds instead of their legacy Date", async () => {
    const target = {
      id: "target", workId: id, editionId: null, publisherId: null, perfumeVariantId: null, perfumeContainer: null,
      perfumeCapacityValue: null, perfumeVolumeUnit: null, filmVersionId: null, filmReleaseId: null, filmMedium: null,
      filmFormatLabel: null, artObjectId: null, artReproducesObjectId: null, isCancelled: true,
      createdAt: new Date(0), hidden_storage_path: "must-not-escape",
    };
    store.targets.mockResolvedValue([{ target, state: "cancelled", instanceId: null }]);
    store.sql.mockResolvedValue([{ id: "target", micros: "-1" }]);
    const response = await POST(request({ entity: "works", ids: [id], format: "json" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Durtal-Export-Schema")).toBe("books/2");
    const [row] = await response.json();
    expect(row.acquisition_targets[0]).toMatchObject({ id: "target", isCancelled: true, state: "cancelled", createdAt: "1969-12-31T23:59:59.999999Z" });
    expect(row.acquisition_targets[0]).not.toHaveProperty("hidden_storage_path");
    expect(target.createdAt.getTime()).toBe(0);
  });

  it("does not reorder shared editions or change legacy bytes when making a native projection", async () => {
    const edition = (editionId: string, isbn: string) => Object.freeze({ id: editionId, isbn13: isbn, isbn10: null,
      publisher: null, imprint: null, publicationYear: null, language: null, binding: null, pageCount: null,
      publisherLinks: Object.freeze([]), instances: Object.freeze([]) });
    const editions = Object.freeze([edition("z-first", "000013"), edition("a-second", "000026")]);
    const raw = Object.freeze({ ...book, editions, workAuthors: Object.freeze([]) });
    store.books.mockResolvedValue([raw]);
    const before = await (await POST(request({ entity: "works", ids: [id], format: "csv" }))).text();
    const native = await (await POST(request({ entity: "works", ids: [id], format: "json" }))).json();
    const after = await (await POST(request({ entity: "works", ids: [id], format: "csv" }))).text();
    expect(after).toBe(before);
    expect(native[0].isbn_13).toBe("000013");
    expect(native[0].edition_publishers.map((e: { edition_id: string }) => e.edition_id)).toEqual(["a-second", "z-first"]);
    expect(editions.map((e) => e.id)).toEqual(["z-first", "a-second"]);
  });

  it("sorts native author ties by stable IDs without changing legacy credit order", async () => {
    const credits = Object.freeze([
      Object.freeze({ id: "credit-b", authorId: "b", sortOrder: 0, author: { name: "Beta" } }),
      Object.freeze({ id: "credit-a", authorId: "a", sortOrder: 0, author: { name: "Alpha" } }),
    ]);
    store.books.mockResolvedValue([{ ...book, workAuthors: credits }]);
    const legacy = await (await POST(request({ entity: "works", ids: [id], format: "csv" }))).text();
    const first = await (await POST(request({ entity: "works", ids: [id], format: "json" }))).json();
    store.books.mockResolvedValue([{ ...book, workAuthors: [...credits].reverse() }]);
    const second = await (await POST(request({ entity: "works", ids: [id], format: "json" }))).json();
    expect(first[0].authors).toEqual(["Alpha", "Beta"]);
    expect(second[0].authors).toEqual(first[0].authors);
    expect(legacy).toContain("Beta; Alpha");
    expect(credits.map((c) => c.id)).toEqual(["credit-b", "credit-a"]);
  });

  it("offers JSON for every kind but the Goodreads file (SLN-894)", async () => {
    for (const entity of ["works", "authors", "films", "perfumes", "paintings", "readings", "reading-sessions", "reading-notes"])
      expect(exportFormatsFor(entity), entity).toContain("json");
    expect(exportFormatsFor("goodreads")).toEqual(["csv"]);
    expect((await POST(request({ entity: "goodreads", all: true, format: "json" }))).status).toBe(400);
  });

  it("sorts books by title, accents and case aside, then by id", async () => {
    store.books.mockResolvedValue([
      { ...book, id: "33333333-3333-3333-3333-333333333333", title: "the Magic Mountain" },
      { ...book, id: "22222222-2222-2222-2222-222222222222", title: "Zazie" },
      book,
      { ...book, id: "00000000-0000-0000-0000-000000000000", title: "A rebours" },
    ]);
    const rows = await (await POST(request({ entity: "works", all: true, format: "json" }))).json();
    expect(rows.map((r: { title: string }) => r.title)).toEqual(["A rebours", "À rebours", "the Magic Mountain", "Zazie"]);
  });

  it("names a record whose title slugs to nothing by its kind and id, and a selection by its kind", async () => {
    store.books.mockResolvedValue([{ ...book, title: "Война и мир" }]);
    const one = await POST(request({ entity: "works", ids: [id], format: "csv" }));
    expect(one.headers.get("content-disposition")).toBe('attachment; filename="durtal-book-11111111-2026-10-09.csv"');
    expect(one.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    store.books.mockResolvedValue([book, { ...book, id: "22222222-2222-2222-2222-222222222222" }]);
    const two = await POST(request({ entity: "works", ids: [id, "22222222-2222-2222-2222-222222222222"], format: "tsv" }));
    expect(two.headers.get("content-disposition")).toBe('attachment; filename="durtal-books-2026-10-09.tsv"');
    expect(two.headers.get("content-type")).toBe("text/tab-separated-values; charset=utf-8");
  });

  it.each([[], ["invalid"], Array.from({ length: 501 }, () => id)])(
    "retains selection validation before fetching rows",
    async (ids) => {
      expect(
        (await POST(request({ entity: "works", ids, format: "json" }))).status,
      ).toBe(400);
      expect(store.books).not.toHaveBeenCalled();
    },
  );

  it("preserves the spreadsheet formula guard on CSV while JSON keeps stored text", async () => {
    const response = await POST(
      request({ entity: "works", ids: [id], format: "csv" }),
    );
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("'=a formula-like note");
    // Nested data in a spreadsheet is JSON text, a boolean yes or no
    expect(text).toContain(',no,');
    expect(text).toContain(',[],[],');
    expect(exportFormatsFor("works")).toEqual([
      "csv",
      "tsv",
      "parquet",
      "json",
    ]);
  });
});
