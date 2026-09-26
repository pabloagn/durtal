import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchIsbndb, searchIsbndbByAuthor, searchIsbndbByIsbn } from "@/lib/api/isbndb";
import { searchGoogleBooks } from "@/lib/api/google-books";
import { searchOpenLibrary } from "@/lib/api/open-library";
import { searchBooks } from "@/lib/api/search-engine";

// Pruned live ISBNdb record/response shape; no credentials or signed image URLs.
const book = {
  title: "Every Short Story by Alasdair Gray 1951-2012",
  isbn13: "9780857865618",
  isbn10: "0857865617",
  authors: ["Alasdair Gray"],
  publisher: "Canongate Books",
  language: "en",
  date_published: "2015",
  pages: 944,
  subjects: ["Fiction", "Short Stories (single author)"],
};
const olDoc = {
  key: "/works/OL123W",
  title: "Lanark",
  author_name: ["Alasdair Gray"],
  isbn: ["9781841959077"],
  publisher: ["Canongate Books"],
};
const fetchMock = vi.fn<typeof fetch>();
const response = (body: unknown, status = 200) => Response.json(body, { status });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ISBNDN_API_KEY", "test-isbndb-secret");
  vi.stubEnv("GOOGLE_BOOKS_API_KEY", "test-google-secret");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("ISBNdb response contracts", () => {
  it.each([
    ["title", () => searchIsbndb("Alasdair Gray")],
    ["author", () => searchIsbndbByAuthor("Alasdair Gray")],
  ])("reads books from a current %s search response", async (_label, search) => {
    fetchMock.mockResolvedValue(response({ books: [book], total: 1, page: 1, page_size: 10 }));
    expect(await search()).toEqual([expect.objectContaining({
      source: "isbndb", title: book.title, authors: book.authors,
      isbn13: book.isbn13, isbn10: book.isbn10, publisher: book.publisher,
      publicationYear: 2015, pageCount: 944, language: "en",
    })]);
  });

  it.each([searchIsbndb, searchIsbndbByAuthor])("retains legacy data-array compatibility", async (search) => {
    fetchMock.mockResolvedValue(response({ data: [book], total: 1 }));
    expect(await search("Alasdair Gray")).toHaveLength(1);
  });

  it("uses the current books field when both response fields exist", async () => {
    fetchMock.mockResolvedValue(response({ books: [], data: [book], total: 0 }));
    expect(await searchIsbndb("unmatched")).toEqual([]);
  });

  it("keeps the existing author-filter query and result limit", async () => {
    fetchMock.mockResolvedValue(response({ books: [book], total: 1 }));
    await searchIsbndbByAuthor("Alasdair Gray", 5);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(decodeURIComponent(url.pathname)).toBe("/books/Alasdair Gray");
    expect(url.searchParams.get("column")).toBe("author");
    expect(url.searchParams.get("pageSize")).toBe("5");
  });

  it("preserves the separate single-book ISBN response contract", async () => {
    fetchMock.mockResolvedValue(response({ book }));
    expect(await searchIsbndbByIsbn(book.isbn10)).toMatchObject({
      source: "isbndb", title: book.title, isbn13: book.isbn13, publisher: book.publisher,
    });
  });

  it("handles an empty successful response", async () => {
    fetchMock.mockResolvedValue(response({ total: 0 }));
    expect(await searchIsbndb("unmatched")).toEqual([]);
  });
});

describe("provider diagnostics", () => {
  it.each([
    ["isbndb", searchIsbndb, 401],
    ["isbndb", searchIsbndbByAuthor, 429],
    ["google_books", searchGoogleBooks, 429],
    ["open_library", searchOpenLibrary, 503],
  ])("logs %s HTTP %s without leaking credentials or provider response bodies", async (provider, search, status) => {
    fetchMock.mockResolvedValue(response({ error: "private response test-google-secret" }, status));
    expect(await search("private query")).toEqual([]);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(`[book-search] ${provider}: HTTP ${status}`);
  });

  it("also diagnoses failed single-ISBN lookups", async () => {
    fetchMock.mockResolvedValue(response({}, 401));
    expect(await searchIsbndbByIsbn(book.isbn10)).toBeNull();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[book-search] isbndb: HTTP 401");
  });

  it("still sends the optional Google key when configured", async () => {
    fetchMock.mockResolvedValue(response({ items: [], totalItems: 0 }));
    await searchGoogleBooks("Lanark");
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("key")).toBe("test-google-secret");
  });

  it("keeps anonymous Google access available without a key", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "");
    fetchMock.mockResolvedValue(response({ items: [], totalItems: 0 }));
    await searchGoogleBooks("Lanark");
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.has("key")).toBe(false);
  });
});

describe("search orchestration with real adapters", () => {
  it("includes ISBNdb title/author metadata when Google is quota-limited", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api2.isbndb.com") return response({ books: [book], total: 1 });
      if (url.hostname === "www.googleapis.com") return response({}, 429);
      return response({ docs: [olDoc], numFound: 1 });
    });
    const results = await searchBooks("Alasdair Gray");
    expect(results).toContainEqual(expect.objectContaining({ source: "isbndb", isbn13: book.isbn13, publisher: book.publisher }));
    expect(results).toContainEqual(expect.objectContaining({ source: "open_library", title: "Lanark" }));
    expect(console.warn).toHaveBeenCalledWith("[book-search] google_books: HTTP 429");
  });

  it("retains exact ISBN lookup and deduplicates a matching edition", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api2.isbndb.com") return response({ book });
      if (url.hostname === "www.googleapis.com") return response({ items: [] });
      return response({ docs: [{ ...olDoc, title: book.title, isbn: [book.isbn13] }] });
    });
    const results = await searchBooks(book.isbn10);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: "isbndb", isbn13: book.isbn13, publisher: book.publisher });
  });

  it.each(["timeout", "bad-json", "missing-key"])("keeps fallback search working after %s without logging sensitive errors", async (failure) => {
    if (failure === "missing-key") vi.stubEnv("ISBNDN_API_KEY", "");
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api2.isbndb.com") {
        if (failure === "bad-json") return new Response("not JSON: test-isbndb-secret");
        throw new Error("request failed for private query with test-isbndb-secret");
      }
      if (url.hostname === "www.googleapis.com") return response({ items: [] });
      return response({ docs: [olDoc], numFound: 1 });
    });
    expect(await searchBooks("Lanark")).toEqual([expect.objectContaining({ source: "open_library", title: "Lanark" })]);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[book-search] isbndb: request failed");
  });
});
