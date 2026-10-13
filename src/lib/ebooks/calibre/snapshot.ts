import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { walkRoots } from "../ingest/group";
import { driftReport } from "./drift";
import { readCalibreDatabase } from "./read-db";
import { METADATA_DB, SNAPSHOT_VERSION, libraryPath, sha256File, type CalibreSnapshot, type DriftField } from "./library";

/*
 * `pnpm ebooks:calibre-snapshot <library folder>` (SLN-656). Copies the
 * library's metadata.db into the cache folder, hashing the source before and
 * after: a library being written to is refused. The copy is read through
 * node:sqlite, opened read-only. Every format metadata.db lists is checked on
 * disk, every other file in the library is named, and each book's OPF is
 * compared with the snapshot. Nothing on the drive is created, changed,
 * moved or deleted.
 */

/** Files Calibre keeps at the library's root for itself */
const LIBRARY_FILES = /^(metadata\.db.*|metadata_db_prefs_backup\.json|full-text-search\.db.*)$/i;
/** Calibre's own journal beside metadata.db while it writes */
const JOURNALS = ["metadata.db-journal", "metadata.db-wal"];

export interface SnapshotOptions {
  cacheDir: string;
  reportDir: string;
  host: string;
  now?: number;
  /** The drive's volume UUID and mount point; the system's tools by default */
  volume?: (folder: string) => { uuid: string | null; mountPoint: string | null };
  /** Tests: runs between the copy and the second hash */
  afterCopy?: () => void;
}

export interface SnapshotCounts {
  books: number;
  formats: number;
  formatsByType: Record<string, number>;
  withCover: number;
  rated: number;
  withCustomValues: number;
  customColumns: number;
  missingFiles: number;
  extraFiles: number;
  opfMissing: number;
  opfOlder: number;
  opfDifferent: number;
  differentFields: Partial<Record<DriftField, number>>;
}

/** The drive a folder is on, as macOS's diskutil or Linux's findmnt says; nulls when neither answers */
export function systemVolume(folder: string): { uuid: string | null; mountPoint: string | null } {
  try {
    if (process.platform === "darwin") {
      const plist = execFileSync("diskutil", ["info", "-plist", folder], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] });
      const value = (key: string) => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1] || null;
      return { uuid: value("VolumeUUID"), mountPoint: value("MountPoint") };
    }
    if (process.platform === "linux") {
      const [uuid, mountPoint] = execFileSync("findmnt", ["-n", "-o", "UUID,TARGET", "-T", folder], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] })
        .trim()
        .split(/\s+/);
      return mountPoint ? { uuid: uuid || null, mountPoint } : { uuid: null, mountPoint: uuid || null };
    }
  } catch {
    // No answer: lineage only, never identity
  }
  return { uuid: null, mountPoint: null };
}

const stampOf = (at: string) => at.replace(/[:.]/g, "-");

/** Copies metadata.db and proves the copy is the file as it was before and after */
async function copyDatabase(root: string, cacheDir: string, afterCopy?: () => void) {
  const source = path.join(root, METADATA_DB);
  for (const journal of JOURNALS) {
    const file = path.join(root, journal);
    if (existsSync(file) && statSync(file).size > 0)
      throw new Error(`Calibre is writing to this library (${journal} is there): close Calibre and take the snapshot again. Nothing copied.`);
  }
  const before = await sha256File(source);
  const info = statSync(source);
  const dir = path.join(cacheDir, "calibre");
  mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, `metadata-${before}.db`);
  const partial = `${copy}.partial`;
  copyFileSync(source, partial);
  afterCopy?.();
  const [after, copied] = await Promise.all([sha256File(source), sha256File(partial)]);
  if (after !== before || copied !== before) {
    rmSync(partial, { force: true });
    throw new Error("metadata.db changed while it was copied: Calibre may be writing to it. Close Calibre and take the snapshot again. Nothing kept.");
  }
  renameSync(partial, copy);
  return { copy, sha256: before, size: info.size, mtimeMs: info.mtimeMs };
}

/** Counts only: what the terminal prints and what Linear and the changelog may carry */
export function snapshotCounts(snapshot: CalibreSnapshot): SnapshotCounts {
  const formats = snapshot.books.flatMap((b) => b.formats);
  const differentFields: Partial<Record<DriftField, number>> = {};
  for (const book of snapshot.drift) for (const field of book.fields) differentFields[field] = (differentFields[field] ?? 0) + 1;
  return {
    books: snapshot.books.length,
    formats: formats.length,
    formatsByType: formats.reduce<Record<string, number>>((all, f) => ((all[f.format] = (all[f.format] ?? 0) + 1), all), {}),
    withCover: snapshot.books.filter((b) => b.hasCover).length,
    rated: snapshot.books.filter((b) => b.rating !== null).length,
    withCustomValues: snapshot.books.filter((b) => Object.keys(b.custom).length > 0).length,
    customColumns: snapshot.columns.length,
    missingFiles: snapshot.files.missing.length,
    extraFiles: snapshot.files.extra.length,
    opfMissing: snapshot.drift.filter((d) => d.missing).length,
    opfOlder: snapshot.drift.filter((d) => d.older).length,
    opfDifferent: snapshot.drift.filter((d) => d.fields.length > 0).length,
    differentFields,
  };
}

/** The report in reports/ebooks: counts, then the files and books it names (the folder is git-ignored) */
export function snapshotReport(snapshot: CalibreSnapshot, snapshotFile: string): string {
  const c = snapshotCounts(snapshot);
  const n = (value: number) => value.toLocaleString("en-US");
  const titles = new Map(snapshot.books.map((b) => [b.id, b.title]));
  const list = (lines: string[], empty: string) => (lines.length ? lines.map((l) => `- ${l}`) : [empty]);
  return [
    `# Calibre snapshot, ${snapshot.takenAt}`,
    "",
    `Library ${snapshot.library.id}, read at ${snapshot.library.path} on ${snapshot.host}. Nothing in the library was written.`,
    `Snapshot: ${snapshotFile}`,
    "",
    "## Counts",
    "",
    "| | |",
    "|---|---|",
    `| Books | ${n(c.books)} |`,
    `| Formats | ${n(c.formats)} (${Object.entries(c.formatsByType).sort((a, b) => b[1] - a[1]).map(([f, k]) => `${f} ${n(k)}`).join(", ") || "none"}) |`,
    `| Books with a cover | ${n(c.withCover)} |`,
    `| Rated books | ${n(c.rated)} |`,
    `| Custom columns | ${n(c.customColumns)}; books with a value in one: ${n(c.withCustomValues)} |`,
    `| Formats missing on disk | ${n(c.missingFiles)} |`,
    `| Files metadata.db does not list | ${n(c.extraFiles)} |`,
    `| OPFs missing | ${n(c.opfMissing)} |`,
    `| OPFs older than the book | ${n(c.opfOlder)} |`,
    `| OPFs that differ | ${n(c.opfDifferent)}${Object.keys(c.differentFields).length ? ` (${Object.entries(c.differentFields).map(([f, k]) => `${f} ${n(k)}`).join(", ")})` : ""} |`,
    "",
    "Where an OPF differs, the snapshot (metadata.db) is what Durtal takes.",
    "",
    "## Formats missing on disk",
    "",
    ...list(snapshot.files.missing.map((m) => `${m.path} (book ${m.bookId}, ${titles.get(m.bookId) ?? ""})`), "None."),
    "",
    "## Files metadata.db does not list",
    "",
    ...list(snapshot.files.extra, "None."),
    "",
    "## Books whose OPF drifts",
    "",
    ...list(
      snapshot.drift.map((d) => `${d.path}: ${[d.missing ? "no OPF" : null, d.older ? "older" : null, d.fields.length ? d.fields.join(", ") : null].filter(Boolean).join("; ")}`),
      "None.",
    ),
    "",
  ].join("\n");
}

/** Takes a snapshot of the library; writes the snapshot into the cache folder and the report into reportDir */
export async function takeCalibreSnapshot(library: string, options: SnapshotOptions) {
  const root = path.resolve(library);
  if (!existsSync(root)) throw new Error(`${library} does not exist: is the drive mounted? Nothing read.`);
  if (!existsSync(path.join(root, METADATA_DB))) throw new Error(`There is no ${METADATA_DB} in ${library}: it is not a Calibre library. Nothing read.`);
  const at = new Date(options.now ?? Date.now()).toISOString();

  const database = await copyDatabase(root, options.cacheDir, options.afterCopy);
  const { libraryId, columns, books } = readCalibreDatabase(database.copy);

  // Every listed format on disk; every other file named
  const listed = new Set<string>();
  const missing: { bookId: number; path: string }[] = [];
  for (const book of books)
    for (const format of book.formats) {
      listed.add(format.path);
      if (!existsSync(libraryPath(root, format.path))) missing.push({ bookId: book.id, path: format.path });
    }
  const bookFolders = new Set(books.map((b) => b.path));
  const { files } = await walkRoots([root]);
  const extra = files
    .map((f) => path.relative(root, f.path).split(path.sep).join("/"))
    .filter((relative) => {
      if (listed.has(relative)) return false;
      if (!relative.includes("/") && LIBRARY_FILES.test(relative)) return false;
      // Calibre's extra data files live in a book folder's data/ folder
      const dataAt = relative.lastIndexOf("/data/");
      return !(dataAt > 0 && bookFolders.has(relative.slice(0, dataAt)));
    })
    .sort();

  const volume = (options.volume ?? systemVolume)(root);
  const snapshot: CalibreSnapshot = {
    v: SNAPSHOT_VERSION,
    takenAt: at,
    host: options.host,
    library: { id: libraryId, path: root, volumeUuid: volume.uuid, mountPoint: volume.mountPoint },
    metadataDb: { sha256: database.sha256, size: database.size, mtimeMs: database.mtimeMs },
    columns,
    books,
    files: { missing, extra },
    drift: driftReport(root, books),
  };

  const snapshotFile = path.join(options.cacheDir, "calibre", `calibre-snapshot-${libraryId}-${stampOf(at)}.json`);
  writeFileSync(snapshotFile, JSON.stringify(snapshot));
  mkdirSync(options.reportDir, { recursive: true });
  const reportFile = path.join(options.reportDir, `calibre-snapshot-${stampOf(at)}.md`);
  writeFileSync(reportFile, snapshotReport(snapshot, snapshotFile));
  return { snapshot, snapshotFile, reportFile, counts: snapshotCounts(snapshot) };
}
