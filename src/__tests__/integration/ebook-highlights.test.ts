import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  getHighlightBooks,
  getHighlightGroups,
  getHighlightSummary,
  MARKS_PER_GROUP,
  parseHighlightParams,
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
    fields: { text?: string; note?: string; color?: string; progression?: number; bookmark?: boolean } = {},
  ) => {
    const progression = fields.progression ?? 0.1;
    const locator = {
      v: 1, fileHash: target.sha256, href: "chapter-1.xhtml", sectionIndex: 0, progression, totalProgression: progression,
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

  it("groups live marks by book, the most recently marked book first, its newest marks first", async () => {
    const result = await groups();
    expect(result.map((group) => group.ebook.title)).toEqual(["La Cathédrale", "À rebours", "Là-bas"]);
    const reboursGroup = result[1];
    expect(reboursGroup.total).toBe(MARKS_PER_GROUP + 3);
    expect(reboursGroup.marks).toHaveLength(MARKS_PER_GROUP);
    expect(reboursGroup.marks[0]).toMatchObject({ text: "Des Esseintes", note: "Décadence, again", color: "sage", kind: "highlight" });
    // The deleted mark neither shows nor counts
    expect(result[2].total).toBe(1);
    expect(result[2].marks.map((item) => item.id)).not.toContain(deleted);
    expect(await summary()).toEqual({ books: 3, marks: MARKS_PER_GROUP + 5 });
  });

  it("shows every mark of one book when filtered to it", async () => {
    const [only] = await groups({ ebook: rebours.id });
    expect(only.marks).toHaveLength(MARKS_PER_GROUP + 3);
    expect(await summary({ ebook: rebours.id })).toEqual({ books: 1, marks: MARKS_PER_GROUP + 3 });
  });

  it("searches text and notes without accents or case", async () => {
    expect((await groups({ q: "decadence" })).map((group) => group.ebook.title)).toEqual(["À rebours"]);
    expect((await groups({ q: "GILLES rais" })).map((group) => group.ebook.title)).toEqual(["Là-bas"]);
    expect(await summary({ q: "lost passage" })).toEqual({ books: 0, marks: 0 });
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
});
