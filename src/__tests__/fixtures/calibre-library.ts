import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeEpub, makeImage, makePdf } from "./ebook-builders";

/*
 * A small Calibre library built in code (SLN-656): a metadata.db with
 * Calibre's own tables, book folders named as Calibre names them, their
 * formats, OPFs and covers. Four books:
 *
 * 1. Nadja: every field, a cover, EPUB and PDF, every kind of custom column,
 *    an OPF that agrees.
 * 2. The Third Policeman: no cover; its OPF is older and says another title
 *    and no tags.
 * 3. Arcane 17: its EPUB is listed but not on disk; no OPF.
 * 4. Les Champs magnétiques: two authors, Calibre's "no date".
 *
 * Plus a file no book lists, Calibre's own files that are never extra, and
 * a trash folder. A test may add books of its own after these (`extra`).
 */

export const LIBRARY_ID = "0b7c2f1e-5d4a-4c3b-9a8e-7f6d5c4b3a21";
export const NADJA_UUID = "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
export const POLICEMAN_UUID = "6b2e3d4c-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
export const ARCANE_UUID = "7c3f4e5d-6a7b-4c8d-ae9f-1a2b3c4d5e6f";
export const CHAMPS_UUID = "8d4a5f6e-7b8c-4d9e-bfa0-2b3c4d5e6f7a";

/** When metadata.db last changed each book */
export const NADJA_MODIFIED = "2024-03-04 10:11:12.123456+00:00";
export const POLICEMAN_MODIFIED = "2024-06-01 08:00:00+00:00";

const SCHEMA = `
CREATE TABLE library_id (id INTEGER PRIMARY KEY, uuid TEXT NOT NULL, UNIQUE(uuid));
CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT 'Unknown' COLLATE NOCASE, sort TEXT COLLATE NOCASE,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, pubdate TIMESTAMP DEFAULT CURRENT_TIMESTAMP, series_index REAL NOT NULL DEFAULT 1.0,
  author_sort TEXT COLLATE NOCASE, isbn TEXT DEFAULT '' COLLATE NOCASE, lccn TEXT DEFAULT '' COLLATE NOCASE, path TEXT NOT NULL DEFAULT '',
  flags INTEGER NOT NULL DEFAULT 1, uuid TEXT, has_cover BOOL DEFAULT 0, last_modified TIMESTAMP NOT NULL DEFAULT '2000-01-01 00:00:00+00:00');
CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, sort TEXT COLLATE NOCASE, link TEXT NOT NULL DEFAULT '', UNIQUE(name));
CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, author INTEGER NOT NULL, UNIQUE(book, author));
CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, sort TEXT COLLATE NOCASE, link TEXT NOT NULL DEFAULT '', UNIQUE (name));
CREATE TABLE books_series_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, series INTEGER NOT NULL, UNIQUE(book));
CREATE TABLE publishers (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, sort TEXT COLLATE NOCASE, link TEXT NOT NULL DEFAULT '', UNIQUE(name));
CREATE TABLE books_publishers_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, publisher INTEGER NOT NULL, UNIQUE(book));
CREATE TABLE languages (id INTEGER PRIMARY KEY, lang_code TEXT NOT NULL COLLATE NOCASE, link TEXT NOT NULL DEFAULT '', UNIQUE(lang_code));
CREATE TABLE books_languages_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, lang_code INTEGER NOT NULL, item_order INTEGER NOT NULL DEFAULT 0, UNIQUE(book, lang_code));
CREATE TABLE identifiers (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'isbn' COLLATE NOCASE, val TEXT NOT NULL COLLATE NOCASE, UNIQUE(book, type));
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, link TEXT NOT NULL DEFAULT '', UNIQUE (name));
CREATE TABLE books_tags_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, tag INTEGER NOT NULL, UNIQUE(book, tag));
CREATE TABLE ratings (id INTEGER PRIMARY KEY, rating INTEGER CHECK(rating > -1 AND rating < 11), link TEXT NOT NULL DEFAULT '', UNIQUE (rating));
CREATE TABLE books_ratings_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, rating INTEGER NOT NULL, UNIQUE(book, rating));
CREATE TABLE comments (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, text TEXT NOT NULL COLLATE NOCASE, UNIQUE(book));
CREATE TABLE data (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, format TEXT NOT NULL COLLATE NOCASE, uncompressed_size INTEGER NOT NULL, name TEXT NOT NULL, UNIQUE(book, format));
CREATE TABLE custom_columns (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, name TEXT NOT NULL, datatype TEXT NOT NULL,
  mark_for_delete BOOL DEFAULT 0 NOT NULL, editable BOOL DEFAULT 1 NOT NULL, display TEXT DEFAULT '{}' NOT NULL,
  is_multiple BOOL DEFAULT 0 NOT NULL, normalized BOOL NOT NULL, UNIQUE(label));
`;

export interface FixtureBook {
  id: number;
  uuid: string;
  title: string;
  sort: string;
  authors: [name: string, sort: string][];
  folder: string;
  fileName: string;
  formats: { format: string; bytes: Uint8Array | null }[];
  pubdate: string;
  added: string;
  modified: string;
  hasCover: boolean;
  series?: [name: string, index: number];
  publisher?: string;
  language?: string;
  identifiers?: [type: string, value: string][];
  tags?: string[];
  rating?: number;
  comments?: string;
}

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A metadata.opf as Calibre writes it beside a book's files (OPF 2.0) */
export function calibreOpf(book: Omit<FixtureBook, "formats" | "folder" | "fileName" | "hasCover">): string {
  return `<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier opf:scheme="calibre" id="calibre_id">${book.id}</dc:identifier>
    <dc:identifier opf:scheme="uuid" id="uuid_id">${book.uuid}</dc:identifier>
    <dc:title>${xml(book.title)}</dc:title>
    ${book.authors.map(([name, sort]) => `<dc:creator opf:file-as="${xml(sort)}" opf:role="aut">${xml(name)}</dc:creator>`).join("\n    ")}
    <dc:contributor opf:file-as="calibre" opf:role="bkp">calibre (7.6.0) [https://calibre-ebook.com]</dc:contributor>
    ${book.pubdate.startsWith("0101") ? "" : `<dc:date>${book.pubdate.replace(" ", "T")}</dc:date>`}
    ${book.comments ? `<dc:description>${xml(book.comments)}</dc:description>` : ""}
    ${book.publisher ? `<dc:publisher>${xml(book.publisher)}</dc:publisher>` : ""}
    ${(book.identifiers ?? []).map(([type, value]) => `<dc:identifier opf:scheme="${type.toUpperCase()}">${value}</dc:identifier>`).join("\n    ")}
    ${book.language ? `<dc:language>${book.language}</dc:language>` : ""}
    ${(book.tags ?? []).map((t) => `<dc:subject>${xml(t)}</dc:subject>`).join("\n    ")}
    ${book.series ? `<meta name="calibre:series" content="${xml(book.series[0])}"/>\n    <meta name="calibre:series_index" content="${book.series[1]}"/>` : ""}
    ${book.rating ? `<meta name="calibre:rating" content="${book.rating}"/>` : ""}
    <meta name="calibre:timestamp" content="${book.added.replace(" ", "T")}"/>
    <meta name="calibre:title_sort" content="${xml(book.sort)}"/>
  </metadata>
  <guide>
    <reference type="cover" title="Cover" href="cover.jpg"/>
  </guide>
</package>`;
}

/** Builds the library under `root`, with any extra books after the four; returns where its files are */
export async function makeCalibreLibrary(root: string, options: { extra?: FixtureBook[] } = {}) {
  const cover = await makeImage("jpeg", { width: 500, height: 800, color: "#443322" });
  const books: FixtureBook[] = [
    {
      id: 1,
      uuid: NADJA_UUID,
      title: "Nadja",
      sort: "Nadja",
      authors: [["André Breton", "Breton, André"]],
      folder: "André Breton/Nadja (1)",
      fileName: "Nadja - André Breton",
      formats: [
        { format: "EPUB", bytes: makeEpub({ metadata: `<dc:title>Nadja (file)</dc:title><dc:creator>A. Breton</dc:creator><dc:language>fr</dc:language>`, salt: "nadja" }) },
        { format: "PDF", bytes: makePdf({ info: { Title: "Nadja", Author: "André Breton" } }) },
      ],
      pubdate: "1928-05-01 00:00:00+00:00",
      added: "2019-05-01 12:34:56.123456+00:00",
      modified: NADJA_MODIFIED,
      hasCover: true,
      series: ["Surrealist Prose", 2],
      publisher: "Gallimard",
      language: "fra",
      identifiers: [
        ["isbn", "9782070360536"],
        ["goodreads", "12345"],
      ],
      tags: ["Surrealism", "Novel"],
      rating: 8,
      comments: "<div><p>A walk through Paris.</p></div>",
    },
    {
      id: 2,
      uuid: POLICEMAN_UUID,
      title: "The Third Policeman",
      sort: "Third Policeman, The",
      authors: [["Flann O'Brien", "O'Brien, Flann"]],
      folder: "Flann O'Brien/The Third Policeman (2)",
      fileName: "The Third Policeman - Flann O'Brien",
      formats: [{ format: "EPUB", bytes: makeEpub({ metadata: `<dc:title>The Third Policeman</dc:title><dc:creator>Flann O'Brien</dc:creator><dc:language>en</dc:language>`, salt: "policeman" }) }],
      pubdate: "1967-01-01 00:00:00+00:00",
      added: "2020-02-02 02:02:02+00:00",
      modified: POLICEMAN_MODIFIED,
      hasCover: false,
      language: "eng",
      tags: ["Fiction"],
    },
    {
      id: 3,
      uuid: ARCANE_UUID,
      title: "Arcane 17",
      sort: "Arcane 17",
      authors: [["André Breton", "Breton, André"]],
      folder: "André Breton/Arcane 17 (3)",
      fileName: "Arcane 17 - André Breton",
      formats: [{ format: "EPUB", bytes: null }],
      pubdate: "1944-01-01 00:00:00+00:00",
      added: "2021-03-03 03:03:03+00:00",
      modified: "2021-03-03 03:03:03+00:00",
      hasCover: false,
      language: "fra",
    },
    {
      id: 4,
      uuid: CHAMPS_UUID,
      title: "Les Champs magnétiques",
      sort: "Champs magnétiques, Les",
      authors: [
        ["André Breton", "Breton, André"],
        ["Philippe Soupault", "Soupault, Philippe"],
      ],
      folder: "André Breton/Les Champs magnetiques (4)",
      fileName: "Les Champs magnetiques - Andre Breton",
      formats: [{ format: "EPUB", bytes: makeEpub({ metadata: `<dc:title>Les Champs magnétiques</dc:title><dc:language>fr</dc:language>`, salt: "champs" }) }],
      pubdate: "0101-01-01 00:00:00+00:00",
      added: "2022-04-04 04:04:04+00:00",
      modified: "2022-04-04 04:04:04+00:00",
      hasCover: false,
      language: "fra",
    },
    ...(options.extra ?? []),
  ];

  mkdirSync(root, { recursive: true });
  const dbFile = path.join(root, "metadata.db");
  const db = new DatabaseSync(dbFile);
  db.exec(SCHEMA);
  const run = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params);
  const idOf = (table: string, column: string, value: string | number) => {
    const found = db.prepare(`SELECT id FROM ${table} WHERE ${column} = ?`).get(value) as { id: number } | undefined;
    return found ? found.id : Number(run(`INSERT INTO ${table} (${column}) VALUES (?)`, value).lastInsertRowid);
  };
  run("INSERT INTO library_id (uuid) VALUES (?)", LIBRARY_ID);

  for (const book of books) {
    run(
      "INSERT INTO books (id, title, sort, timestamp, pubdate, series_index, author_sort, path, uuid, has_cover, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      book.id, book.title, book.sort, book.added, book.pubdate, book.series?.[1] ?? 1, book.authors.map(([, s]) => s).join(" & "), book.folder, book.uuid, book.hasCover ? 1 : 0, book.modified,
    );
    for (const [name, sort] of book.authors) {
      const author = (db.prepare("SELECT id FROM authors WHERE name = ?").get(name) as { id: number } | undefined)?.id ?? Number(run("INSERT INTO authors (name, sort) VALUES (?, ?)", name, sort).lastInsertRowid);
      run("INSERT INTO books_authors_link (book, author) VALUES (?, ?)", book.id, author);
    }
    if (book.series) run("INSERT INTO books_series_link (book, series) VALUES (?, ?)", book.id, idOf("series", "name", book.series[0]));
    if (book.publisher) run("INSERT INTO books_publishers_link (book, publisher) VALUES (?, ?)", book.id, idOf("publishers", "name", book.publisher));
    if (book.language) run("INSERT INTO books_languages_link (book, lang_code, item_order) VALUES (?, ?, 0)", book.id, idOf("languages", "lang_code", book.language));
    for (const [type, value] of book.identifiers ?? []) run("INSERT INTO identifiers (book, type, val) VALUES (?, ?, ?)", book.id, type, value);
    for (const tag of book.tags ?? []) run("INSERT INTO books_tags_link (book, tag) VALUES (?, ?)", book.id, idOf("tags", "name", tag));
    if (book.rating) run("INSERT INTO books_ratings_link (book, rating) VALUES (?, ?)", book.id, idOf("ratings", "rating", book.rating));
    if (book.comments) run("INSERT INTO comments (book, text) VALUES (?, ?)", book.id, book.comments);

    const folder = path.join(root, ...book.folder.split("/"));
    mkdirSync(folder, { recursive: true });
    for (const { format, bytes } of book.formats) {
      run("INSERT INTO data (book, format, uncompressed_size, name) VALUES (?, ?, ?, ?)", book.id, format, bytes?.length ?? 4096, book.fileName);
      if (bytes) writeFileSync(path.join(folder, `${book.fileName}.${format.toLowerCase()}`), bytes);
    }
    if (book.hasCover) writeFileSync(path.join(folder, "cover.jpg"), cover);
  }

  // Custom columns, as Calibre keeps each kind
  const columns: [label: string, name: string, datatype: string, multiple: number, normalized: number][] = [
    ["read", "Read", "bool", 0, 0],
    ["readdate", "Date read", "datetime", 0, 0],
    ["shelf", "Shelves", "text", 1, 1],
    ["myrating", "My rating", "rating", 0, 1],
    ["notes", "Notes", "comments", 0, 0],
    ["collection", "Collection", "series", 0, 1],
    ["pages", "Pages", "int", 0, 0],
    ["words", "Words", "composite", 0, 0],
    ["gone", "Deleted column", "text", 0, 1],
  ];
  for (const [label, name, datatype, multiple, normalized] of columns) {
    const id = Number(run("INSERT INTO custom_columns (label, name, datatype, is_multiple, normalized, mark_for_delete) VALUES (?, ?, ?, ?, ?, ?)", label, name, datatype, multiple, normalized, label === "gone" ? 1 : 0).lastInsertRowid);
    if (datatype === "composite") continue;
    const valueType = { bool: "BOOL", datetime: "TIMESTAMP", int: "INT", rating: "INT" }[datatype] ?? "TEXT";
    if (normalized) {
      db.exec(`CREATE TABLE custom_column_${id} (id INTEGER PRIMARY KEY AUTOINCREMENT, value ${valueType} NOT NULL, link TEXT NOT NULL DEFAULT '', UNIQUE(value))`);
      db.exec(`CREATE TABLE books_custom_column_${id}_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, value INTEGER NOT NULL${datatype === "series" ? ", extra REAL" : ""}, UNIQUE(book, value))`);
    } else db.exec(`CREATE TABLE custom_column_${id} (id INTEGER PRIMARY KEY AUTOINCREMENT, book INTEGER, value ${valueType} NOT NULL, UNIQUE(book))`);
    const link = (book: number, value: string | number, extra?: number) => {
      const valueId = idOf(`custom_column_${id}`, "value", value);
      if (extra === undefined) run(`INSERT INTO books_custom_column_${id}_link (book, value) VALUES (?, ?)`, book, valueId);
      else run(`INSERT INTO books_custom_column_${id}_link (book, value, extra) VALUES (?, ?, ?)`, book, valueId, extra);
    };
    const value = (book: number, v: string | number) => run(`INSERT INTO custom_column_${id} (book, value) VALUES (?, ?)`, book, v);
    if (label === "read") {
      value(1, 1);
      value(2, 0);
    }
    if (label === "readdate") value(1, "2020-01-02 00:00:00+00:00");
    if (label === "shelf") {
      link(1, "Favourites");
      link(1, "Paris");
    }
    if (label === "myrating") link(1, 9);
    if (label === "notes") value(1, "<p>Reread every spring.</p>");
    if (label === "collection") link(1, "Paris books", 3);
    if (label === "pages") value(4, 120);
    if (label === "gone") link(1, "never read");
  }
  db.close();

  // The OPFs: Nadja's agrees and is current; the Policeman's is older and differs; Arcane 17 has none
  const [nadja, policeman, , champs] = books;
  const opf = (book: FixtureBook) => path.join(root, ...book.folder.split("/"), "metadata.opf");
  writeFileSync(opf(nadja), calibreOpf(nadja));
  writeFileSync(opf(champs), calibreOpf(champs));
  writeFileSync(opf(policeman), calibreOpf({ ...policeman, title: "Third Policeman", tags: [] }));
  const before = new Date("2023-01-01T00:00:00Z");
  utimesSync(opf(policeman), before, before);

  // A file no book lists; Calibre's own files and folders, never extra
  writeFileSync(path.join(root, ...nadja.folder.split("/"), "Nadja copy.epub"), makeEpub({ salt: "stray" }));
  writeFileSync(path.join(root, "metadata_db_prefs_backup.json"), "{}");
  mkdirSync(path.join(root, ...nadja.folder.split("/"), "data"), { recursive: true });
  writeFileSync(path.join(root, ...nadja.folder.split("/"), "data", "notes.txt"), "Notes kept with the book.");
  mkdirSync(path.join(root, ".caltrash", "b", "9"), { recursive: true });
  writeFileSync(path.join(root, ".caltrash", "b", "9", "Old.epub"), "x");

  return {
    root,
    dbFile,
    nadjaFolder: path.join(root, ...nadja.folder.split("/")),
    policemanFolder: path.join(root, ...policeman.folder.split("/")),
    champsFolder: path.join(root, ...champs.folder.split("/")),
  };
}
