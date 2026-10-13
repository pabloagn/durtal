/**
 * A snapshot of a Calibre library (SLN-656), on the machine that holds it.
 *
 *   pnpm ebooks:calibre-snapshot <library folder> [--cache-dir DIR] [--report-dir DIR] [--host LABEL]
 *
 * Copies the library's metadata.db into the cache folder (refused when it
 * changes during the copy), reads the copy read-only and writes
 * calibre-snapshot-<libraryId>-<time>.json into <cache>/calibre, plus a
 * report in reports/ebooks. Plan from it with
 * `pnpm ebooks:ingest --calibre <snapshot>`. Nothing in the library is
 * created, changed, moved or deleted, and Calibre need not be installed.
 * No database and no bucket are read.
 */
import { parseArgs } from "node:util";
import { homedir, hostname } from "node:os";
import { resolve } from "node:path";
import { takeCalibreSnapshot } from "@/lib/ebooks/calibre/snapshot";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "cache-dir": { type: "string", default: resolve(homedir(), ".cache/durtal-ebooks") },
    "report-dir": { type: "string", default: "reports/ebooks" },
    host: { type: "string" },
  },
});

try {
  if (positionals.length !== 1) throw new Error("Name the Calibre library folder: pnpm ebooks:calibre-snapshot /Volumes/<drive>/<library>");
  const { counts, snapshotFile, reportFile } = await takeCalibreSnapshot(positionals[0], {
    cacheDir: resolve(values["cache-dir"]!),
    reportDir: resolve(values["report-dir"]!),
    host: values.host ?? hostname().replace(/\.local$/i, ""),
  });
  console.log(
    `${counts.books} books, ${counts.formats} formats, ${counts.withCover} with a cover. ` +
      `${counts.missingFiles} formats missing on disk, ${counts.extraFiles} files not listed. ` +
      `OPFs: ${counts.opfMissing} missing, ${counts.opfOlder} older, ${counts.opfDifferent} different.`,
  );
  console.log("Read-only: nothing in the library was written.");
  console.log(`Snapshot: ${snapshotFile}\nReport:   ${reportFile}`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
