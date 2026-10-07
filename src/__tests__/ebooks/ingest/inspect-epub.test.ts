import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectEpub } from "@/lib/ebooks/ingest/inspect/epub";
import { planIngest } from "@/lib/ebooks/ingest/plan";
import { bytesSource } from "@/lib/ebooks/ingest/source";
import type { Db } from "@/lib/catalogue/work-store";
import { defaultChapters, makeEpub, makeSidecarOpf } from "../../fixtures/ebook-builders";

/* SLN-494: an EPUB's package document, its sidecar, and the spine it must have */

const inspect = (bytes: Uint8Array) => inspectEpub(bytesSource(bytes, "book.epub"), "epub");

describe("EPUB metadata", () => {
  it("reads EPUB 2's opf:scheme ISBN, opf:role and opf:file-as", async () => {
    const { metadata, problem, details } = await inspect(makeEpub({ version: "2.0" }));
    expect(problem).toBeNull();
    expect(metadata.identifiers).toContainEqual({ scheme: "isbn", value: "9780306406157" });
    expect(metadata.authors).toEqual([{ name: "Anna Vale", fileAs: "Vale, Anna", role: "aut" }]);
    expect(metadata).toMatchObject({ title: "The House by the River", language: "en", publisher: "River Press", date: "2004-05-01" });
    expect(details).toMatchObject({ epubVersion: "2.0", hasNav: false, hasNcx: true });
  });

  it("reads EPUB 3's refines: role, file-as, identifier-type and title-type", async () => {
    const metadata3 = `
      <dc:title id="t1">Ficciones</dc:title><meta refines="#t1" property="title-type">main</meta>
      <dc:title id="t2">Stories</dc:title><meta refines="#t2" property="title-type">subtitle</meta>
      <dc:creator id="c1">Jorge Luis Borges</dc:creator>
      <meta refines="#c1" property="role" scheme="marc:relators">aut</meta>
      <meta refines="#c1" property="file-as">Borges, Jorge Luis</meta>
      <dc:creator id="c2">Anthony Kerrigan</dc:creator><meta refines="#c2" property="role">trl</meta>
      <dc:identifier id="bookid">urn:isbn:9780802130303</dc:identifier>
      <dc:identifier id="i2">0306406152</dc:identifier><meta refines="#i2" property="identifier-type" scheme="onix:codelist5">02</meta>
      <dc:language>es</dc:language>
      <meta property="belongs-to-collection" id="s1">Obras</meta><meta refines="#s1" property="group-position">2</meta>`;
    const { metadata, details } = await inspect(makeEpub({ metadata: metadata3 }));
    expect(metadata).toMatchObject({ title: "Ficciones", subtitle: "Stories", language: "es", series: "Obras", seriesIndex: 2 });
    expect(metadata.authors).toEqual([
      { name: "Jorge Luis Borges", fileAs: "Borges, Jorge Luis", role: "aut" },
      { name: "Anthony Kerrigan", fileAs: null, role: "trl" },
    ]);
    expect(metadata.identifiers).toEqual(expect.arrayContaining([{ scheme: "isbn", value: "9780802130303" }, { scheme: "isbn", value: "0306406152" }]));
    expect(details).toMatchObject({ epubVersion: "3.0", hasNav: true, hasNcx: true });
  });

  it("reads a series from calibre:series", async () => {
    const metadata = `<dc:title>Book</dc:title><meta name="calibre:series" content="River Books"/><meta name="calibre:series_index" content="3.5"/>`;
    expect((await inspect(makeEpub({ metadata }))).metadata).toMatchObject({ series: "River Books", seriesIndex: 3.5 });
  });

  it("records the layout, the direction and a page list", async () => {
    const metadata = `<dc:title>Manga</dc:title><meta property="rendition:layout">pre-paginated</meta>`;
    const navExtra = `<nav epub:type="page-list"><ol><li><a href="c1.xhtml#p1">1</a></li><li><a href="c2.xhtml#p2">2</a></li></ol></nav>`;
    const result = await inspect(makeEpub({ metadata, navExtra, spineAttributes: `page-progression-direction="rtl"` }));
    expect(result.manifest.epub).toEqual({ version: "3.0", fixedLayout: true, direction: "rtl", hasPageList: true });
    expect(result.details).toMatchObject({ printPages: 2 });
  });
});

describe("a damaged EPUB is quarantined with its reason", () => {
  it("an empty spine", async () => {
    expect((await inspect(makeEpub({ emptySpine: true }))).problem).toBe("Empty spine: the EPUB lists no chapters");
  });
  it("a spine item missing from the zip", async () => {
    expect((await inspect(makeEpub({ omit: ["OEBPS/c2.xhtml"] }))).problem).toBe("Damaged EPUB: the chapter c2.xhtml is missing");
  });
  it("a zip whose central directory is gone", async () => {
    const epub = makeEpub();
    expect((await inspect(epub.subarray(0, epub.length - 120))).problem).toMatch(/^Damaged zip/);
  });
});

describe("a sidecar metadata.opf", () => {
  let dir: string;
  const uuid = "2c7e8d10-4b5a-4c3d-9e8f-0a1b2c3d4e5f";
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ingest-sidecar-"));
    const folder = path.join(dir, "Vale, Anna", "The House by the River (42)");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "The House by the River - Anna Vale.epub"), makeEpub({ chapters: defaultChapters(4) }));
    writeFileSync(
      path.join(folder, "metadata.opf"),
      makeSidecarOpf({ title: "The House on the River", author: "Anna M. Vale", fileAs: "Vale, Anna M.", uuid, rating: 8, customColumn: true, series: "River Books", seriesIndex: 1 }),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const emptyCatalogue = { select: () => ({ from: () => Object.assign(Promise.resolve([]), { where: async () => [] }) }) } as unknown as Db;

  it("wins field by field, keeps the file's own under embedded, gives the import ref and counts its personal data", async () => {
    const plan = await planIngest([dir], { database: emptyCatalogue, host: "test", cacheDir: path.join(dir, ".cache"), target: { database: "t", bucket: "b", prefix: "", preview: true } });
    expect(plan.groups).toHaveLength(1);
    const [group] = plan.groups;
    expect(group).toMatchObject({ importSource: "folder", importRef: uuid, personalData: true });
    // The sidecar's title and author; the EPUB's publisher, where the sidecar has none
    expect(group.ebook).toMatchObject({ title: "The House on the River", authors: ["Anna M. Vale"], authorSort: "Vale, Anna M.", publisher: "River Press", series: "River Books", seriesIndex: 1 });
    const file = plan.files[group.paths[0]];
    expect(file.metadata).toMatchObject({ title: "The House on the River", sidecar: true, embedded: { title: "The House by the River" } });
    // The rating and the custom column are never read into the metadata
    expect(JSON.stringify(file.metadata)).not.toMatch(/rating|user_metadata|#read/);
    expect(plan.summary.personalData).toBe(1);
  }, 60_000);
});
