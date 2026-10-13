import { DatabaseSync } from "node:sqlite";
import type { CalibreBook, CalibreColumn, CalibreCustomValue } from "./library";

/*
 * Reads a copy of a Calibre metadata.db (SLN-656) through Node's own
 * SQLite, opened read-only. Never the library's own file: the snapshot
 * copies it first. The tables are Calibre's own: books, authors, series,
 * publishers, languages, identifiers, tags, ratings, comments, data,
 * custom_columns and the custom_column_N tables, library_id.
 */

type Row = Record<string, unknown>;

/** Calibre's timestamps ("2019-05-01 12:34:56.123456+00:00") as ISO 8601; its year-101 "no date" as null */
export function calibreDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  const time = Date.parse(text);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  if (date.getUTCFullYear() <= 101) return null;
  return date.toISOString();
}

/** Calibre's 0 to 10 as 0.5 to 5 stars; 0 is unrated */
export const calibreStars = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(10, Math.round(n)) / 2 : null;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** Rows grouped by their book column, in the order the query gave them */
function byBook<T>(rows: Row[], map: (row: Row) => T): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const row of rows) {
    const book = Number(row.book);
    if (!out.has(book)) out.set(book, []);
    out.get(book)!.push(map(row));
  }
  return out;
}

function customValue(column: CalibreColumn, row: Row): CalibreCustomValue {
  const value = row.value;
  switch (column.type) {
    case "bool":
      return value === null ? null : Number(value) !== 0;
    case "int":
    case "float":
      return value === null ? null : Number(value);
    case "rating":
      return calibreStars(value);
    case "datetime":
      return calibreDate(value);
    case "series":
      return typeof value === "string" ? { series: value, index: row.extra === null || row.extra === undefined ? null : Number(row.extra) } : null;
    default:
      return text(value);
  }
}

/** Everything the snapshot holds, from a metadata.db opened read-only */
export function readCalibreDatabase(file: string): { libraryId: string; columns: CalibreColumn[]; books: CalibreBook[] } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const all = (sql: string) => db.prepare(sql).all() as Row[];
    const tables = new Set(all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name)));
    if (!tables.has("books") || !tables.has("library_id")) throw new Error("This metadata.db has no books or library_id table: it is not a Calibre library.");
    const libraryId = text(all("SELECT uuid FROM library_id LIMIT 1")[0]?.uuid);
    if (!libraryId) throw new Error("This metadata.db has no library id.");

    const authors = byBook(all("SELECT l.book, a.name, a.sort FROM books_authors_link l JOIN authors a ON a.id = l.author ORDER BY l.book, l.id"), (r) => ({
      name: String(r.name),
      sort: text(r.sort),
    }));
    const series = byBook(all("SELECT l.book, s.name FROM books_series_link l JOIN series s ON s.id = l.series ORDER BY l.id"), (r) => String(r.name));
    const publishers = byBook(all("SELECT l.book, p.name FROM books_publishers_link l JOIN publishers p ON p.id = l.publisher ORDER BY l.id"), (r) => String(r.name));
    const languages = byBook(all("SELECT l.book, g.lang_code FROM books_languages_link l JOIN languages g ON g.id = l.lang_code ORDER BY l.book, l.item_order, l.id"), (r) =>
      String(r.lang_code),
    );
    const identifiers = byBook(all("SELECT book, type, val FROM identifiers ORDER BY book, id"), (r) => ({ type: String(r.type).toLowerCase(), value: String(r.val) }));
    const tags = byBook(all("SELECT l.book, t.name FROM books_tags_link l JOIN tags t ON t.id = l.tag ORDER BY l.book, l.id"), (r) => String(r.name));
    const ratings = byBook(all("SELECT l.book, r.rating FROM books_ratings_link l JOIN ratings r ON r.id = l.rating ORDER BY l.id"), (r) => calibreStars(r.rating));
    const comments = byBook(all("SELECT book, text FROM comments ORDER BY id"), (r) => text(r.text));
    const formats = byBook(all("SELECT book, format, uncompressed_size, name FROM data ORDER BY book, format"), (r) => ({
      format: String(r.format).toLowerCase(),
      size: Number(r.uncompressed_size ?? 0),
      name: String(r.name),
    }));

    // Custom columns: normalized ones keep values in their own table, linked; the rest one row per book
    const columns: CalibreColumn[] = [];
    const custom = new Map<number, Record<string, CalibreCustomValue>>();
    const columnRows = tables.has("custom_columns")
      ? all("SELECT id, label, name, datatype, is_multiple, normalized FROM custom_columns WHERE mark_for_delete = 0 ORDER BY id")
      : [];
    for (const row of columnRows) {
      const column: CalibreColumn = { label: String(row.label), name: String(row.name), type: String(row.datatype), isMultiple: Number(row.is_multiple) === 1 };
      columns.push(column);
      const id = Number(row.id);
      const values = `custom_column_${id}`;
      const link = `books_custom_column_${id}_link`;
      if (!tables.has(values)) continue; // a composite column is computed, never stored
      const normalized = Number(row.normalized) === 1 && tables.has(link);
      const hasExtra = normalized && (db.prepare(`PRAGMA table_info(${link})`).all() as Row[]).some((c) => c.name === "extra");
      const rows = normalized
        ? all(`SELECT l.book, v.value${hasExtra ? ", l.extra" : ""} FROM ${link} l JOIN ${values} v ON v.id = l.value ORDER BY l.book, l.id`)
        : all(`SELECT book, value FROM ${values} ORDER BY book, id`);
      for (const [book, entries] of byBook(rows, (r) => customValue(column, r))) {
        const present = entries.filter((v) => v !== null);
        if (!present.length) continue;
        const record = custom.get(book) ?? {};
        record[column.label] = column.isMultiple ? (present as string[]) : present[0];
        custom.set(book, record);
      }
    }

    const books = all("SELECT id, title, sort, author_sort, timestamp, pubdate, series_index, path, uuid, has_cover, last_modified FROM books ORDER BY id").map((r): CalibreBook => {
      const id = Number(r.id);
      const folder = String(r.path);
      const hasCover = Number(r.has_cover) === 1;
      const bookSeries = series.get(id)?.[0] ?? null;
      return {
        id,
        uuid: String(r.uuid ?? "").toLowerCase(),
        title: String(r.title ?? ""),
        titleSort: text(r.sort),
        authors: authors.get(id) ?? [],
        authorSort: text(r.author_sort),
        series: bookSeries,
        seriesIndex: bookSeries && r.series_index !== null ? Number(r.series_index) : null,
        publisher: publishers.get(id)?.[0] ?? null,
        pubdate: calibreDate(r.pubdate),
        languages: languages.get(id) ?? [],
        identifiers: identifiers.get(id) ?? [],
        tags: tags.get(id) ?? [],
        rating: ratings.get(id)?.[0] ?? null,
        description: comments.get(id)?.[0] ?? null,
        hasCover,
        coverPath: hasCover ? `${folder}/cover.jpg` : null,
        path: folder,
        added: calibreDate(r.timestamp),
        lastModified: calibreDate(r.last_modified),
        formats: (formats.get(id) ?? []).map((f) => ({ format: f.format, size: f.size, path: `${folder}/${f.name}.${f.format}` })),
        custom: custom.get(id) ?? {},
      };
    });
    return { libraryId: libraryId.toLowerCase(), columns, books };
  } finally {
    db.close();
  }
}
