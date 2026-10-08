/**
 * The e-book bucket against the catalogue (SLN-491). Read-only by default:
 * lists the bucket once, HEADs every object an ebook_files row names with
 * its SHA-256, and reports matches, missing objects, size or checksum
 * mismatches, rows with no key and objects no row names (older than a day;
 * younger ones are in flight). The session refuses writes, and a probe
 * proves it first.
 *
 * `--apply --backup FILE` (a pg_dump custom-format backup written in the
 * last hour) marks matches verified and mismatches missing, and records a
 * verification run for /ebooks/runs. It never deletes or changes an object.
 *
 *   pnpm ebooks:verify [--apply --backup FILE] [--report-dir DIR] [--env-dir DIR]
 *
 * Reports: reports/ebooks/verify-<timestamp>.md and .csv (git-ignored).
 */
import { parseArgs } from "node:util";
import { hostname } from "node:os";
import { resolve } from "node:path";
import dotenv from "dotenv";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    backup: { type: "string" },
    "report-dir": { type: "string", default: "reports/ebooks" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
dotenv.config({
  path: [resolve(values["env-dir"]!, ".env.local"), resolve(values["env-dir"]!, ".env")],
  quiet: true,
});
const url = process.env.PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

// Imported after the environment loads: the env schema and the S3 client read it
const postgres = (await import("postgres")).default;
const { drizzle } = await import("drizzle-orm/postgres-js");
const { assertReadOnly, readOnlySession } = await import("@/lib/enrichment/read-only-session");
const { runEbookVerification } = await import("@/lib/ebooks/verify");
type Db = import("@/lib/catalogue/work-store").Db;

const session = values.apply ? postgres(url, { max: 4, onnotice: () => {} }) : readOnlySession(url);
try {
  if (!values.apply) await assertReadOnly(session);
  const { report, applied, files } = await runEbookVerification({
    database: drizzle(session) as unknown as Db,
    apply: values.apply,
    backup: values.backup,
    reportDir: resolve(values["report-dir"]!),
    host: hostname().replace(/\.local$/i, ""),
  });
  const count = (outcome: string) => report.rows.filter((r) => r.outcome === outcome).length;
  console.log(
    `${report.rows.length} files: ${count("verified")} verified, ${count("missing-object")} missing, ` +
      `${count("size-mismatch") + count("checksum-mismatch")} differ, ${count("no-key")} with no key; ` +
      `${report.unreferenced.length} objects no row names, ${report.inFlight.length} in flight.`,
  );
  console.log(applied ? `Applied: ${applied.verified} verified, ${applied.missing} missing.` : "Read-only: nothing was written.");
  console.log(`Report: ${files.markdown}\n        ${files.csv}`);
} finally {
  await session.end();
}
