/**
 * Calibre's ratings and read dates as a reading import (SLN-658).
 *
 *   pnpm ebooks:reading-import --calibre SNAPSHOT [--read-column LABEL] [--read-date-column LABEL]
 *     [--create [--live]] [--preview PORT | --aws-profile PROFILE] [--env-dir DIR]
 *
 * One row for each Calibre book of the snapshot that is a linked e-book in
 * Durtal and has a rating or a read. The rating is Calibre's own; the read
 * and its date come from the custom columns named (with or without the "#"),
 * and a name the snapshot lacks is refused. Only the snapshot is read: the
 * drive need not be mounted.
 *
 * Without --create it counts and writes nothing. With --create it makes the
 * import, which waits at /reading/import/<id>: every rating that differs and
 * every read shows there, and nothing reaches a book until it is committed
 * there. A non-preview database also needs --live.
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { loadEnvironment } from "./environment";

const { values } = parseArgs({
  options: {
    calibre: { type: "string" },
    "read-column": { type: "string" },
    "read-date-column": { type: "string" },
    create: { type: "boolean", default: false },
    live: { type: "boolean", default: false },
    preview: { type: "string" },
    "aws-profile": { type: "string" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});

try {
  if (!values.calibre) throw new Error("Give --calibre SNAPSHOT, the snapshot pnpm ebooks:calibre-snapshot took");
  const { preview } = await loadEnvironment({ preview: values.preview, envDir: values["env-dir"]!, awsProfile: values["aws-profile"] });
  if (values.create && !preview && !values.live) throw new Error("This is not a preview database: add --live to make the import there. Nothing created.");

  // Imported after the environment loads: the env schema reads it
  const { db } = await import("@/lib/db");
  const { readSnapshot } = await import("@/lib/ebooks/calibre/library");
  const { calibreReadingRows, linkedCalibreBooks } = await import("@/lib/ebooks/calibre/reading");
  const { snapshot } = readSnapshot(resolve(values.calibre));
  const linked = await linkedCalibreBooks(db, snapshot.library.id);
  const { rows, rowNos } = calibreReadingRows(snapshot, linked, { read: values["read-column"], readDate: values["read-date-column"] });
  const reads = rows.filter((r) => r.readings.length).length;
  const dated = rows.filter((r) => r.readings.some((x) => x.finishedOn)).length;
  const rated = rows.filter((r) => r.rating !== null).length;
  console.log(
    `${linked.length} Calibre books are linked e-books in Durtal; ${rows.length} have a rating or a read: ` +
      `${rated} rated, ${reads} read (${dated} with a date).`,
  );
  if (!values.create) {
    console.log("Counted only: nothing was written. Add --create to make the import.");
  } else if (!rows.length) {
    console.log("Nothing to import: no import made.");
  } else {
    const { createLibraryReadingImport } = await import("@/lib/reading/import/store");
    const made = await createLibraryReadingImport({ rows, rowNos, name: "E-book library" });
    console.log(`Import made with ${made.rows} rows; nothing is written to a book until it is committed at /reading/import/${made.importId}.`);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
