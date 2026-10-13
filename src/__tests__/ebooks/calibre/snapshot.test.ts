import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { takeCalibreSnapshot } from "@/lib/ebooks/calibre/snapshot";
import { calibreFileMetadata, libraryPath, readSnapshot } from "@/lib/ebooks/calibre/library";
import { planIngest } from "@/lib/ebooks/ingest/plan";
import { applyPlan, planSha256, resumeRun } from "@/lib/ebooks/ingest/run";
import type { Db } from "@/lib/catalogue/work-store";
import { ARCANE_UUID, CHAMPS_UUID, LIBRARY_ID, NADJA_UUID, POLICEMAN_UUID, makeCalibreLibrary } from "../../fixtures/calibre-library";
import { makeEpub, makeImage } from "../../fixtures/ebook-builders";

/* SLN-656: Joris's Calibre library read once, read-only, into a snapshot the planner uses */

let dir: string;
let library: Awaited<ReturnType<typeof makeCalibreLibrary>>;
let cacheDir: string;
let reportDir: string;
const volume = () => ({ uuid: "6A1F0C1E-2B3D-4E5F-8A9B-0C1D2E3F4A5B", mountPoint: "/Volumes/Books" });
const snap = (root = library.root, extra: Partial<Parameters<typeof takeCalibreSnapshot>[1]> = {}) =>
  takeCalibreSnapshot(root, { cacheDir, reportDir, host: "test-mac", volume, now: Date.parse("2026-10-13T10:00:00Z"), ...extra });

/** Every file under a folder with its checksum and modification time */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(root, full)] = `${createHash("sha256").update(readFileSync(full)).digest("hex")} ${statSync(full).mtimeMs}`;
    }
  };
  walk(root);
  return out;
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "calibre-"));
  library = await makeCalibreLibrary(path.join(dir, "Books", "Calibre Library"));
  cacheDir = path.join(dir, "cache");
  reportDir = path.join(dir, "reports");
}, 60_000);
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the snapshot", () => {
  it("holds every field of every book, the custom columns and the library's identity", async () => {
    const { snapshot, snapshotFile } = await snap();
    expect(path.basename(snapshotFile)).toBe(`calibre-snapshot-${LIBRARY_ID}-2026-10-13T10-00-00-000Z.json`);
    expect(readSnapshot(snapshotFile).snapshot).toEqual(snapshot);
    expect(snapshot.library).toEqual({ id: LIBRARY_ID, path: library.root, volumeUuid: volume().uuid, mountPoint: "/Volumes/Books" });
    expect(snapshot.metadataDb.sha256).toBe(createHash("sha256").update(readFileSync(library.dbFile)).digest("hex"));
    expect(snapshot.books.map((b) => b.uuid)).toEqual([NADJA_UUID, POLICEMAN_UUID, ARCANE_UUID, CHAMPS_UUID]);

    const [nadja, policeman, , champs] = snapshot.books;
    expect(nadja).toEqual({
      id: 1,
      uuid: NADJA_UUID,
      title: "Nadja",
      titleSort: "Nadja",
      authors: [{ name: "André Breton", sort: "Breton, André" }],
      authorSort: "Breton, André",
      series: "Surrealist Prose",
      seriesIndex: 2,
      publisher: "Gallimard",
      pubdate: "1928-05-01T00:00:00.000Z",
      languages: ["fra"],
      identifiers: [
        { type: "isbn", value: "9782070360536" },
        { type: "goodreads", value: "12345" },
      ],
      tags: ["Surrealism", "Novel"],
      rating: 4,
      description: "<div><p>A walk through Paris.</p></div>",
      hasCover: true,
      coverPath: "André Breton/Nadja (1)/cover.jpg",
      path: "André Breton/Nadja (1)",
      added: "2019-05-01T12:34:56.123Z",
      lastModified: "2024-03-04T10:11:12.123Z",
      formats: [
        { format: "epub", size: statSync(path.join(library.nadjaFolder, "Nadja - André Breton.epub")).size, path: "André Breton/Nadja (1)/Nadja - André Breton.epub" },
        { format: "pdf", size: statSync(path.join(library.nadjaFolder, "Nadja - André Breton.pdf")).size, path: "André Breton/Nadja (1)/Nadja - André Breton.pdf" },
      ],
      custom: {
        read: true,
        readdate: "2020-01-02T00:00:00.000Z",
        shelf: ["Favourites", "Paris"],
        myrating: 4.5,
        notes: "<p>Reread every spring.</p>",
        collection: { series: "Paris books", index: 3 },
      },
    });
    expect(policeman).toMatchObject({ rating: null, series: null, seriesIndex: null, hasCover: false, coverPath: null, custom: { read: false }, languages: ["eng"] });
    expect(champs).toMatchObject({
      authors: [
        { name: "André Breton", sort: "Breton, André" },
        { name: "Philippe Soupault", sort: "Soupault, Philippe" },
      ],
      authorSort: "Breton, André & Soupault, Philippe",
      pubdate: null,
      custom: { pages: 120 },
    });
    // A column marked for deletion is gone; a composite one is listed, with no stored values
    expect(snapshot.columns.map((c) => [c.label, c.type, c.isMultiple])).toEqual([
      ["read", "bool", false],
      ["readdate", "datetime", false],
      ["shelf", "text", true],
      ["myrating", "rating", false],
      ["notes", "comments", false],
      ["collection", "series", false],
      ["pages", "int", false],
      ["words", "composite", false],
    ]);
  });

  it("names the formats missing on disk and the files no book lists, never Calibre's own", async () => {
    const { snapshot, counts } = await snap();
    expect(snapshot.files).toEqual({
      missing: [{ bookId: 3, path: "André Breton/Arcane 17 (3)/Arcane 17 - André Breton.epub" }],
      extra: ["André Breton/Nadja (1)/Nadja copy.epub"],
      outside: [],
    });
    expect(counts).toMatchObject({ books: 4, formats: 5, formatsByType: { epub: 4, pdf: 1 }, withCover: 1, rated: 1, withCustomValues: 3, customColumns: 8, missingFiles: 1, extraFiles: 1 });
  });

  it("counts the OPFs that are missing, older or different, field by field; the snapshot wins", async () => {
    const { snapshot, counts, reportFile } = await snap();
    expect(snapshot.drift).toEqual([
      { bookId: 2, path: "Flann O'Brien/The Third Policeman (2)", missing: false, older: true, fields: ["title", "tags"] },
      { bookId: 3, path: "André Breton/Arcane 17 (3)", missing: true, older: false, fields: [] },
    ]);
    expect(counts).toMatchObject({ opfMissing: 1, opfOlder: 1, opfDifferent: 1, differentFields: { title: 1, tags: 1 } });
    const report = readFileSync(reportFile, "utf8");
    expect(report).toContain("| OPFs that differ | 1 (title 1, tags 1) |");
    expect(report).toContain("- André Breton/Nadja (1)/Nadja copy.epub");
    expect(report).toContain("- Flann O'Brien/The Third Policeman (2): older; title, tags");
  });

  it("leaves every byte and modification time in the library as it was", async () => {
    const before = tree(library.root);
    await snap();
    expect(tree(library.root)).toEqual(before);
  });

  it("refuses a metadata.db that changes during the copy, and keeps no copy", async () => {
    const write = () => {
      const db = new DatabaseSync(library.dbFile);
      db.prepare("UPDATE books SET title = 'Nadja (edited)' WHERE id = 1").run();
      db.close();
    };
    await expect(snap(library.root, { afterCopy: write })).rejects.toThrow("metadata.db changed while it was copied");
    expect(readdirSync(path.join(cacheDir, "calibre"))).toEqual([]);
  });

  it("refuses a library Calibre is writing to, and a folder that is not a library", async () => {
    writeFileSync(path.join(library.root, "metadata.db-journal"), "journal");
    await expect(snap()).rejects.toThrow("Calibre is writing to this library");
    await expect(snap(path.join(dir, "Books"))).rejects.toThrow("not a Calibre library");
    await expect(snap(path.join(dir, "Unmounted"))).rejects.toThrow("is the drive mounted?");
  });

  it("gives the same identities for the same library at another mount point", async () => {
    const elsewhere = path.join(dir, "Other drive", "Calibre Library");
    cpSync(library.root, elsewhere, { recursive: true, preserveTimestamps: true });
    const first = (await snap()).snapshot;
    const second = (await snap(elsewhere)).snapshot;
    expect(second.library.id).toBe(first.library.id);
    expect(second.library.path).toBe(elsewhere);
    expect(second.books).toEqual(first.books);
    expect(second.files).toEqual(first.files);
    expect(second.drift).toEqual(first.drift);
  });
});

describe("planning from a snapshot", () => {
  /** An empty catalogue: what the plan reads when nothing is stored yet */
  const emptyCatalogue = { select: () => ({ from: () => Object.assign(Promise.resolve([]), { where: async () => [] }) }) } as unknown as Db;
  /** A database the refused steps must never touch */
  const untouchable = new Proxy({}, { get: () => { throw new Error("The database was touched"); } }) as unknown as Db;
  const target = { database: "test", bucket: "durtal-ebooks", prefix: "", preview: true };
  const plan = (snapshotFile: string, root = library.root) => planIngest([root], { database: emptyCatalogue, host: "test-mac", cacheDir, target, calibre: snapshotFile });

  it("makes each Calibre book one e-book, its fields over its OPF's over the files', with Calibre's cover", async () => {
    const { snapshotFile } = await snap();
    const result = await plan(snapshotFile);
    expect(result.calibre).toMatchObject({
      snapshot: snapshotFile,
      libraryId: LIBRARY_ID,
      libraryPath: library.root,
      books: 4,
      missing: ["André Breton/Arcane 17 (3)/Arcane 17 - André Breton.epub"],
    });
    // The stray copy is never planned: only what metadata.db lists
    expect(result.items.map((i) => path.relative(library.root, i.path)).sort()).toEqual([
      "André Breton/Les Champs magnetiques (4)/Les Champs magnetiques - Andre Breton.epub",
      "André Breton/Nadja (1)/Nadja - André Breton.epub",
      "André Breton/Nadja (1)/Nadja - André Breton.pdf",
      "Flann O'Brien/The Third Policeman (2)/The Third Policeman - Flann O'Brien.epub",
    ]);
    expect(result.groups.map((g) => [g.key, g.importSource, g.importRef, g.paths.length, g.personalData])).toEqual([
      [`calibre:${CHAMPS_UUID}`, "folder", CHAMPS_UUID, 1, true],
      [`calibre:${NADJA_UUID}`, "folder", NADJA_UUID, 2, true],
      [`calibre:${POLICEMAN_UUID}`, "folder", POLICEMAN_UUID, 1, true],
    ]);
    expect(result.summary).toMatchObject({ found: 4, ebooksToCreate: 3, formatsToAdd: 1 });

    const nadja = result.groups.find((g) => g.importRef === NADJA_UUID)!;
    // The EPUB says "Nadja (file)" by "A. Breton": the snapshot wins
    expect(nadja.ebook).toMatchObject({
      title: "Nadja",
      authors: ["André Breton"],
      authorSort: "Breton, André",
      series: "Surrealist Prose",
      seriesIndex: 2,
      publisher: "Gallimard",
      publishedYear: 1928,
      language: "fr",
      isbns: ["9782070360536"],
      subjects: ["Surrealism", "Novel"],
      description: "A walk through Paris.",
    });
    expect(result.groups.find((g) => g.importRef === POLICEMAN_UUID)!.ebook.title).toBe("The Third Policeman");

    const epub = result.files[nadja.paths[0]];
    expect(epub.metadata).toMatchObject({ title: "Nadja", embedded: { title: "Nadja (file)" } });
    expect(epub.metadata.calibre).toMatchObject({ libraryId: LIBRARY_ID, bookId: 1, uuid: NADJA_UUID, snapshotSha256: result.calibre!.snapshotSha256, rating: 4, custom: { read: true }, format: { format: "epub" } });
    expect(epub.metadata.calibre).not.toHaveProperty("formats");
    // Both formats show Calibre's cover.jpg, made once into the cache
    const covers = nadja.paths.map((p) => result.files[p].derived.filter((d) => d.name.startsWith("cover-")));
    expect(covers[0].map((d) => d.name)).toEqual(["cover-240.webp", "cover-400.webp", "cover-800.webp"]);
    for (const list of covers) for (const cover of list) expect(cover.cachePath).toMatch(/calibre-cover-[0-9a-f]{64}/);
    expect(covers[0].map((d) => d.sha256)).toEqual(covers[1].map((d) => d.sha256));
    for (const cover of covers[0]) expect(createHash("sha256").update(readFileSync(cover.cachePath!)).digest("hex")).toBe(cover.sha256);
    expect(result.files[nadja.paths[0]].coverKey).toBe(covers[0][2].key);
  }, 60_000);

  it("refuses to plan, apply or resume once metadata.db has changed since the snapshot", async () => {
    const { snapshotFile } = await snap();
    const planned = await plan(snapshotFile);
    const planFile = path.join(dir, "plan.json");
    const text = JSON.stringify(planned);
    writeFileSync(planFile, text);
    const backup = path.join(dir, "backup.dump");
    writeFileSync(backup, "PGDMP fake custom-format header");
    const options = { database: untouchable, host: "test-mac", cacheDir, target, backup, live: false, localDatabase: true, reportDir };

    appendFileSync(library.dbFile, Buffer.alloc(16));
    await expect(plan(snapshotFile)).rejects.toThrow("The Calibre library changed since its snapshot");
    await expect(applyPlan(planFile, options)).rejects.toThrow("The Calibre library changed since its snapshot");

    // A resume reads its run, then the plan it executed; the library is checked before anything is written
    const sha = planSha256(text);
    const run = { id: "run-1", host: "test-mac", kind: "apply", planSha256: sha, state: "interrupted" };
    const runs = { select: () => ({ from: () => ({ where: async () => [run] }) }), update: () => { throw new Error("The database was written"); } } as unknown as Db;
    cpSync(planFile, path.join(cacheDir, "plans", `${sha}.json`));
    await expect(resumeRun("run-1", { ...options, database: runs })).rejects.toThrow("The Calibre library changed since its snapshot");

    // Unmounted: said plainly
    rmSync(path.join(dir, "Books"), { recursive: true });
    await expect(applyPlan(planFile, options)).rejects.toThrow("The Calibre library is not mounted");
    expect(existsSync(path.join(cacheDir, "plans", `${sha}.json`))).toBe(true);
  }, 60_000);

  it("never takes Calibre's \"Unknown\" title or author as a value", async () => {
    const { snapshot } = await snap();
    const metadata = calibreFileMetadata({ ...snapshot.books[0], title: "Unknown", authors: [{ name: "Unknown", sort: "Unknown" }] });
    expect(metadata).toMatchObject({ title: null, authors: [] });
  });

  it("reads nothing outside the library folder: a \"..\" in metadata.db or a symlink leading out is listed and never opened", async () => {
    // Outside the library: a book, a cover and an OPF that must never be read
    const outside = path.join(dir, "Elsewhere");
    mkdirSync(path.join(outside, "Outside (5)"), { recursive: true });
    writeFileSync(path.join(outside, "Outside (5)", "Outside.epub"), makeEpub({ salt: "outside" }));
    writeFileSync(path.join(outside, "secret.epub"), makeEpub({ salt: "secret" }));
    writeFileSync(path.join(outside, "cover.jpg"), await makeImage("jpeg", { width: 300, height: 450, color: "#aa0000" }));
    const db = new DatabaseSync(library.dbFile);
    db.prepare("INSERT INTO books (id, title, sort, path, uuid, has_cover, last_modified) VALUES (5, 'Outside', 'Outside', '../../Elsewhere/Outside (5)', '9e5b6a7f-8c9d-4eaf-b0a1-3c4d5e6f7a8b', 0, '2022-01-01 00:00:00+00:00')").run();
    db.prepare("INSERT INTO data (book, format, uncompressed_size, name) VALUES (5, 'EPUB', 10, 'Outside')").run();
    db.close();
    const champs = path.join(library.champsFolder, "Les Champs magnetiques - Andre Breton.epub");
    unlinkSync(champs);
    symlinkSync(path.join(outside, "secret.epub"), champs);
    unlinkSync(path.join(library.nadjaFolder, "cover.jpg"));
    symlinkSync(path.join(outside, "cover.jpg"), path.join(library.nadjaFolder, "cover.jpg"));

    expect(libraryPath(library.root, "../../Elsewhere/secret.epub")).toBeNull();
    expect(libraryPath(library.root, "André Breton/Les Champs magnetiques (4)/Les Champs magnetiques - Andre Breton.epub")).toBeNull();
    expect(libraryPath(library.root, "André Breton/Nadja (1)/Nadja - André Breton.pdf")).toBe(path.join(library.nadjaFolder, "Nadja - André Breton.pdf"));

    const { snapshot, snapshotFile, reportFile } = await snap();
    expect(snapshot.files.outside).toEqual([
      { bookId: 1, path: "André Breton/Nadja (1)/cover.jpg" },
      { bookId: 4, path: "André Breton/Les Champs magnetiques (4)/Les Champs magnetiques - Andre Breton.epub" },
      { bookId: 5, path: "../../Elsewhere/Outside (5)/Outside.epub" },
      { bookId: 5, path: "../../Elsewhere/Outside (5)/metadata.opf" },
    ]);
    expect(snapshot.files.missing.map((m) => m.bookId)).toEqual([3]);
    expect(readFileSync(reportFile, "utf8")).toContain("| Paths leading outside the library, never read | 4 |");

    const result = await plan(snapshotFile);
    expect(result.calibre!.outside).toEqual([
      "André Breton/Les Champs magnetiques (4)/Les Champs magnetiques - Andre Breton.epub",
      "../../Elsewhere/Outside (5)/Outside.epub",
    ]);
    expect(result.items.map((i) => path.relative(library.root, i.path)).sort()).toEqual([
      "André Breton/Nadja (1)/Nadja - André Breton.epub",
      "André Breton/Nadja (1)/Nadja - André Breton.pdf",
      "Flann O'Brien/The Third Policeman (2)/The Third Policeman - Flann O'Brien.epub",
    ]);
    // The symlinked cover.jpg is not read: Nadja keeps its files' own covers
    for (const p of result.groups.find((g) => g.importRef === NADJA_UUID)!.paths)
      expect(result.files[p].derived.some((d) => d.cachePath)).toBe(false);
  }, 60_000);

  it("is refused for more than one folder", async () => {
    const { snapshotFile } = await snap();
    await expect(planIngest([library.root, dir], { database: emptyCatalogue, host: "test-mac", cacheDir, target, calibre: snapshotFile })).rejects.toThrow("one library folder");
  });
});
