import { describe, expect, it } from "vitest";
import { cleanDescription, mergeMetadata, METADATA_PRECEDENCE, publishedYearOf, storable, storableText, titleSortKey } from "@/lib/ebooks/ingest/metadata";
import { failureMessage } from "@/lib/ebooks/ingest/run";

/* SLN-494: one e-book's fields from what its files say */

describe("mergeMetadata", () => {
  it("takes each field from the first source that has it, in precedence order", () => {
    expect(METADATA_PRECEDENCE).toEqual(["sidecar", "epub", "azw3", "mobi", "fb2", "pdf", "cbz", "filename"]);
    const merged = mergeMetadata(
      [
        { source: "pdf", metadata: { title: "PDF Title", publisher: "PDF Press", language: "fr", date: "1990" } },
        { source: "mobi", metadata: { title: "MOBI Title", subjects: ["Mobi subject"] } },
        { source: "epub", metadata: { title: "EPUB Title", authors: [{ name: "Anna Vale", role: "aut" }] } },
        { source: "sidecar", metadata: { title: "Sidecar Title" } },
      ],
      "file name.pdf",
    );
    expect(merged).toMatchObject({ title: "Sidecar Title", authors: ["Anna Vale"], publisher: "PDF Press", language: "fr", publishedYear: 1990, subjects: ["Mobi subject"] });
  });

  it("falls back to the file name for the title", () => {
    expect(mergeMetadata([], "The_Third_Policeman.kepub.epub").title).toBe("The Third Policeman");
  });

  it("puts authors in natural order and keeps their sort form", () => {
    const merged = mergeMetadata([{ source: "epub", metadata: { authors: [{ name: "Borges, Jorge Luis", role: "aut" }, { name: "Anthony Kerrigan", role: "trl" }] } }], "x.epub");
    expect(merged.authors).toEqual(["Jorge Luis Borges"]);
    expect(merged.authorSort).toBe("Borges, Jorge Luis");
    const fileAs = mergeMetadata([{ source: "epub", metadata: { authors: [{ name: "Jorge Luis Borges", fileAs: "Borges, Jorge Luis" }] } }], "x.epub");
    expect(fileAs.authorSort).toBe("Borges, Jorge Luis");
  });

  it("validates ISBNs: ISBN-10 becomes ISBN-13, an invalid one goes to isbn_invalid", () => {
    const merged = mergeMetadata(
      [
        {
          source: "epub",
          metadata: {
            identifiers: [
              { scheme: "isbn", value: "0-306-40615-2" },
              { scheme: "isbn", value: "urn:isbn:9780306406157" },
              { scheme: "isbn", value: "9780306406158" },
              { scheme: "mobi-asin", value: "B000FC1234" },
            ],
          },
        },
      ],
      "x.epub",
    );
    expect(merged.isbns).toEqual(["9780306406157"]);
    expect(merged.identifiers).toEqual({ asin: ["B000FC1234"], isbn_invalid: ["9780306406158"] });
  });

  it("makes the year-101 placeholder null, normalises the language and builds the sort title and search text", () => {
    expect(publishedYearOf("0101-01-01T00:00:00+00:00")).toBeNull();
    expect(publishedYearOf("2001-01-01T00:00:00+00:00")).toBe(2001);
    const merged = mergeMetadata([{ source: "epub", metadata: { title: "The Rings of Saturn", language: "eng", date: "0101-01-01", series: "W. G. Sebald", seriesIndex: 2 } }], "x.epub");
    expect(merged).toMatchObject({ publishedYear: null, language: "en", series: "W. G. Sebald", seriesIndex: 2 });
    expect(merged.titleSort).toBe(titleSortKey("Rings of Saturn"));
    expect(merged.searchText).toContain("rings of saturn");
    expect(titleSortKey("Book 10") > titleSortKey("Book 9")).toBe(true);
  });

  it("cleans a hostile description into plain paragraphs, at most 20,000 characters", () => {
    const hostile = `<p onclick="steal()">First <b>bold</b> line.</p><script>alert(1)</script><style>p{}</style><p>Second&nbsp;&amp; last.</p><img src=x onerror=alert(1)>`;
    expect(cleanDescription(hostile)).toBe("First bold line.\n\nSecond & last.");
    expect(cleanDescription(`<p>${"word ".repeat(10_000)}</p>`)!.length).toBe(20_000 - 1);
  });

  it("keeps no character PostgreSQL refuses: NUL from UTF-16 titles and C strings, and unpaired surrogates", () => {
    const utf16 = (text: string) => [...text].map((c) => `${c}\u0000`).join("");
    const merged = mergeMetadata(
      [
        {
          source: "pdf",
          metadata: {
            title: utf16("Report"),
            authors: [{ name: "Ana Ruiz\u0000", fileAs: null, role: null }],
            identifiers: [{ scheme: "isbn", value: "9780306406157\u0000" }, { scheme: "do\u0000i", value: "10.1000/1\uD800" }],
            publisher: "Press\u0000",
            description: "<p>First\u0000 line.</p>",
            subjects: ["Hist\u0000ory"],
          },
        },
      ],
      "scan.pdf",
    );
    expect(merged).toMatchObject({ title: "Report", authors: ["Ana Ruiz"], isbns: ["9780306406157"], publisher: "Press", description: "First line.", subjects: ["History"] });
    expect(merged.identifiers).toEqual({ doi: ["10.1000/1\uFFFD"] });
    expect(storableText("a\u0000b\uD800c\uDC00")).toBe("ab\uFFFDc\uFFFD");
    const bytes = new Uint8Array([0]);
    const deep = storable({ title: "x\u0000", details: { pages: ["p\u0000"], at: new Date(0), bytes }, "k\u0000": null });
    expect(deep).toEqual({ title: "x", details: { pages: ["p"], at: new Date(0), bytes }, k: null });
    expect(deep.details.bytes).toBe(bytes);
  });
});

describe("failureMessage", () => {
  it("records the database's own words, never the failed query and its parameters, cleaned and at most 500 characters", () => {
    const cause = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: "22021" });
    const query = new Error(`Failed query: insert into "ebooks" ("title") values ($1)\nparams: R\u0000e\u0000${"x".repeat(20_000)}`, { cause });
    expect(failureMessage(query)).toBe('invalid byte sequence for encoding "UTF8": 0x00');
    const long = failureMessage(new Error(`Failed query: ${"y\u0000".repeat(1_000)}`));
    expect(long).toHaveLength(500);
    expect(long).not.toContain("\u0000");
    expect(failureMessage(new Error("Refused for the test", { cause: query }))).toBe("Refused for the test");
  });
});
