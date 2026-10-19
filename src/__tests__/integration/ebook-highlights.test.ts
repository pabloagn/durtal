import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  getEbookMarkCounts,
  getHighlightBooks,
  getHighlightGroups,
  getHighlightSummary,
  MARKS_PER_GROUP,
  parseHighlightParams,
  SHOWN_NOTE_CHARS,
  SHOWN_TEXT_CHARS,
} from "@/lib/ebooks/highlights";

// Added to the local harness manifest automatically. Never connect outside its disposable database.
const url = process.env.DURTAL_EBOOK_HIGHLIGHTS_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln500_ebook_highlights");
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln500_ebook_highlights")
    throw new Error("E-book highlight tests require disposable local sln500_ebook_highlights");
}
const client = url ? postgres(url, { prepare: false, max: 1, onnotice: () => {} }) : null;
const database = client ? drizzle(client) : null;

/*
 * SLN-500: /ebooks/highlights lists every live mark of every e-book, grouped
 * by book, newest mark first, filtered by text, colour, kind and book.
 */
describe.skipIf(!url)("the all-highlights queries", () => {
  const c = client!;
  let n = 0;
  const book = async (title: string) => {
    n += 1;
    const [{ id }] = await c`insert into ebooks ${c({ title, import_source: "folder" })} returning id`;
    const [file] = await c`insert into ebook_files ${c({
      ebook_id: id,
      sha256: n.toString(16).padStart(64, "0"),
      format: "epub",
      size_bytes: 1000,
      content_type: "application/epub+zip",
      s3_key: `gold/ebooks/${n}.epub`,
      status: "stored",
    })} returning id, sha256`;
    return { id: id as string, fileId: file.id as string, sha256: file.sha256 as string };
  };
  type Book = Awaited<ReturnType<typeof book>>;
  const mark = async (
    target: Book,
    fields: { text?: string; note?: string; color?: string; progression?: number; bookmark?: boolean; section?: number; cfi?: string } = {},
  ) => {
    const progression = fields.progression ?? 0.1;
    const locator = {
      v: 1, fileHash: target.sha256, href: "chapter-1.xhtml", sectionIndex: fields.section ?? 0, progression, totalProgression: progression,
      ...(fields.cfi ? { cfi: fields.cfi } : {}),
      ...(fields.bookmark ? {} : { text: { highlight: fields.text ?? "the gothic dusk" } }),
    };
    const kind = fields.bookmark ? "bookmark" : "highlight";
    const color = fields.bookmark ? null : (fields.color ?? "ochre");
    const text = fields.bookmark ? null : (fields.text ?? "the gothic dusk");
    const [row] = await c`insert into ebook_annotations
      (ebook_id, file_id, kind, color, text, note, chapter, locator, progression, client_updated_at)
      values (${target.id}, ${target.fileId}, ${kind}, ${color}, ${text}, ${fields.note ?? null}, 'Chapter One',
        ${JSON.stringify(locator)}::text::jsonb, ${progression}, now()) returning id`;
    return row.id as string;
  };
  const groups = (query: Record<string, string> = {}) => getHighlightGroups(parseHighlightParams(query), database!);
  const summary = (query: Record<string, string> = {}) => getHighlightSummary(parseHighlightParams(query), database!);

  let labas: Book;
  let rebours: Book;
  let cathedrale: Book;
  let deleted: string;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln500_ebook_highlights");
    labas = await book("Là-bas");
    rebours = await book("À rebours");
    cathedrale = await book("La Cathédrale");
    await mark(labas, { text: "Gilles de Rais", color: "rose" });
    deleted = await mark(labas, { text: "a lost passage" });
    for (let i = 0; i < MARKS_PER_GROUP + 2; i += 1) await mark(rebours, { text: `the tortoise ${i}`, progression: i / 10 });
    await mark(rebours, { text: "Des Esseintes", note: "Décadence, again", color: "sage" });
    await mark(cathedrale, { bookmark: true, progression: 0.5 });
    await c`update ebook_annotations set deleted_at = updated_at where id = ${deleted}`;
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  it("groups live marks by book, the most recently marked book first, its marks in book order", async () => {
    const result = await groups();
    expect(result.map((group) => group.ebook.title)).toEqual(["La Cathédrale", "À rebours", "Là-bas"]);
    const reboursGroup = result[1];
    expect(reboursGroup.total).toBe(MARKS_PER_GROUP + 3);
    expect(reboursGroup.marks).toHaveLength(MARKS_PER_GROUP);
    expect(reboursGroup.marks[0]).toMatchObject({ text: "the tortoise 0", kind: "highlight" });
    // The deleted mark neither shows nor counts
    expect(result[2].total).toBe(1);
    expect(result[2].marks.map((item) => item.id)).not.toContain(deleted);
    expect(await summary()).toEqual({ books: 3, marks: MARKS_PER_GROUP + 5 });
  });

  it("shows every mark of one book when filtered to it, paged by marks", async () => {
    const [only] = await groups({ ebook: rebours.id });
    expect(only.marks).toHaveLength(MARKS_PER_GROUP + 3);
    expect(await summary({ ebook: rebours.id })).toEqual({ books: 1, marks: MARKS_PER_GROUP + 3 });
    const params = parseHighlightParams({ ebook: rebours.id });
    const [second] = await getHighlightGroups({ ...params, perPage: 3, page: 2, offset: 3 }, database!);
    expect(second.total).toBe(MARKS_PER_GROUP + 3);
    expect(second.marks.map((item) => item.id)).toEqual(only.marks.slice(3, 6).map((item) => item.id));
  });

  it("lists a book's marks in book order, whatever was edited last (SLN-1000)", async () => {
    const huysmans = await book("En route");
    // Made out of order, then the first one edited last. Two marks a page
    // apart can carry reversed progressions; their CFIs order them
    const late = await mark(huysmans, { text: "the Trappist dawn", section: 3, progression: 0.7, cfi: "epubcfi(/6/8!/4/2/1:4)" });
    const second = await mark(huysmans, { text: "plainchant", section: 1, progression: 0.31, cfi: "epubcfi(/6/4!/4/10/1:0)" });
    const first = await mark(huysmans, { text: "Durtal at Saint-Sulpice", section: 1, progression: 0.32, cfi: "epubcfi(/6/4!/4/2[p1]/1:30)" });
    const bookmark = await mark(huysmans, { bookmark: true, section: 2, progression: 0.5, cfi: "epubcfi(/6/6!/4/2,/1:0,/1:9)" });
    await c`update ebook_annotations set note = 'Edited last', updated_at = now() + interval '1 minute' where id = ${first}`;
    const order = [first, second, bookmark, late];
    const [only] = await groups({ ebook: huysmans.id });
    expect(only.marks.map((item) => item.id)).toEqual(order);
    const params = parseHighlightParams({ ebook: huysmans.id });
    const [paged] = await getHighlightGroups({ ...params, perPage: 2, page: 2, offset: 2 }, database!);
    expect(paged.marks.map((item) => item.id)).toEqual(order.slice(2));
    // Unfiltered, the book comes first as the newest edited, with the same order
    const [newest] = await groups();
    expect(newest.ebook.id).toBe(huysmans.id);
    expect(newest.marks.map((item) => item.id)).toEqual(order);
    await c`update ebook_annotations set deleted_at = updated_at where ebook_id = ${huysmans.id}`;
  });

  it("cuts long text and notes by characters, never inside one", async () => {
    const long = await book("Les Foules de Lourdes");
    const astral = "\u{1D504}";
    await mark(long, { text: "a".repeat(SHOWN_TEXT_CHARS - 2) + astral + "tail", note: "n".repeat(SHOWN_NOTE_CHARS + 5) });
    const [group] = await groups({ ebook: long.id });
    const [shown] = group.marks;
    expect([...shown.text!]).toHaveLength(SHOWN_TEXT_CHARS);
    expect(shown.text!.endsWith(astral + "…")).toBe(true);
    expect([...shown.note!]).toHaveLength(SHOWN_NOTE_CHARS);
    await c`update ebook_annotations set deleted_at = updated_at where ebook_id = ${long.id}`;
  });

  it("searches text and notes without accents or case", async () => {
    expect((await groups({ q: "decadence" })).map((group) => group.ebook.title)).toEqual(["À rebours"]);
    expect((await groups({ q: "GILLES rais" })).map((group) => group.ebook.title)).toEqual(["Là-bas"]);
    expect(await summary({ q: "lost passage" })).toEqual({ books: 0, marks: 0 });
  });

  it("finds Korean, kana and й as typed, as the text is stored (SLN-1234)", async () => {
    const other = await book("Песни");
    await mark(other, { text: "한강의 소년이 온다", note: "猫である, Достоевский" });
    const titles = async (q: string) => (await groups({ q })).map((group) => group.ebook.title);
    expect(await titles("소년이")).toEqual(["Песни"]);
    expect(await titles("猫である")).toEqual(["Песни"]);
    expect(await titles("ДОСТОЕВСКИЙ")).toEqual(["Песни"]);
    await c`update ebook_annotations set deleted_at = updated_at where ebook_id = ${other.id}`;
  });

  it("filters by colour and kind", async () => {
    expect((await groups({ color: "rose" })).map((group) => group.ebook.title)).toEqual(["Là-bas"]);
    expect((await groups({ kind: "bookmark" })).map((group) => group.ebook.title)).toEqual(["La Cathédrale"]);
    expect(await summary({ kind: "note" })).toEqual({ books: 1, marks: 1 });
    expect(await summary({ kind: "highlight,bookmark" })).toEqual({ books: 3, marks: MARKS_PER_GROUP + 5 });
  });

  it("sorts by title and pages by book", async () => {
    expect((await groups({ sort: "title" })).map((group) => group.ebook.title)).toEqual(["À rebours", "Là-bas", "La Cathédrale"]);
    const second = await getHighlightGroups({ ...parseHighlightParams({ sort: "title" }), perPage: 1, page: 2, offset: 1 }, database!);
    expect(second.map((group) => group.ebook.title)).toEqual(["Là-bas"]);
  });

  it("offers each marked book once, most marked first", async () => {
    expect(await getHighlightBooks(database!)).toEqual([
      { id: rebours.id, title: "À rebours", marks: MARKS_PER_GROUP + 3 },
      expect.objectContaining({ marks: 1 }),
      expect.objectContaining({ marks: 1 }),
    ]);
  });

  it("counts one book's live highlights, notes and bookmarks for its page", async () => {
    expect(await getEbookMarkCounts(rebours.id, database!)).toEqual({ highlights: MARKS_PER_GROUP + 3, notes: 1, bookmarks: 0 });
    expect(await getEbookMarkCounts(cathedrale.id, database!)).toEqual({ highlights: 0, notes: 0, bookmarks: 1 });
    // The deleted mark does not count
    expect(await getEbookMarkCounts(labas.id, database!)).toEqual({ highlights: 1, notes: 0, bookmarks: 0 });
  });
});
