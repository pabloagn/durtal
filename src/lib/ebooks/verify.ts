import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { atomicOn } from "@/lib/db/atomic";
import { ebookFiles, ebookIngestRuns } from "@/lib/db/schema";
import { recentBackup } from "@/lib/enrichment/backup";
import { ebooksPrefix } from "./keys";
import { ebookObjectKind, ebookStorage, headEbookObject, isNoSuchBucket, listEbookObjects, type EbookListedObject } from "./storage";

/*
 * The e-book bucket against the catalogue (SLN-491). Read-only by default:
 * one listing of the bucket, a HEAD with its SHA-256 for every object a file
 * row names, and the objects no row names. `--apply` (after a pg_dump from
 * the last hour) marks matches verified and mismatches missing. Nothing here
 * ever deletes or changes an object.
 */

/** An object is written before its row, so a younger one may still be in flight */
export const IN_FLIGHT_HOURS = 24;
const HEADS_AT_ONCE = 8;
/** Goes up whenever a verification would count differently */
const VERIFY_TOOL_VERSION = 1;
const ROWS_PER_WRITE = 500;

export type VerifyOutcome = "verified" | "missing-object" | "size-mismatch" | "checksum-mismatch" | "no-key";

export interface VerifiedRow {
  id: string;
  s3Key: string;
  status: string;
  outcome: VerifyOutcome;
  expectedSize: number;
  actualSize: number | null;
  expectedSha256: string;
  actualSha256: string | null;
  /** full: S3's checksum of the whole object; composite: a multipart upload's, checked with the sha256 metadata */
  checksum: "full" | "composite" | "none" | null;
}

export interface VerifyReport {
  at: Date;
  bucket: string;
  prefix: string;
  objectsListed: number;
  rows: VerifiedRow[];
  /** Objects under files/ and derived/ that no row names, older than a day */
  unreferenced: EbookListedObject[];
  /** The same, younger than a day: uploads whose rows may still come */
  inFlight: EbookListedObject[];
}

/**
 * The objects under files/ and derived/ that no row names. A derived object
 * belongs to the file whose checksum names its folder.
 */
export async function ebookOrphans(database: Db, objects: EbookListedObject[], now = Date.now()) {
  const rows = await database.select({ s3Key: ebookFiles.s3Key, sha256: ebookFiles.sha256 }).from(ebookFiles);
  const keys = new Set(rows.map((r) => r.s3Key));
  const checksums = new Set(rows.map((r) => r.sha256));
  const prefix = ebooksPrefix();
  const cutoff = now - IN_FLIGHT_HOURS * 3600_000;
  const unreferenced: EbookListedObject[] = [];
  const inFlight: EbookListedObject[] = [];
  for (const object of objects) {
    const kind = ebookObjectKind(object.key, prefix);
    const named =
      kind === "file"
        ? keys.has(object.key)
        : kind === "derived"
          ? checksums.has(object.key.slice(prefix.length).split("/")[1] ?? "")
          : true; // staging/ expires by itself; anything else is not the catalogue's
    if (named) continue;
    if (object.lastModified && object.lastModified.getTime() < cutoff) unreferenced.push(object);
    else inFlight.push(object);
  }
  return { unreferenced, inFlight };
}

/**
 * The e-book part of the orphan report (scripts/maintenance/report-orphaned-s3.ts):
 * the objects under files/ and derived/ that no row names. Before the AWS
 * setup the bucket does not exist, and the report says so.
 */
export async function ebookOrphanReport(database: Db, now = Date.now()) {
  const { bucket, prefix } = ebookStorage();
  const prefixes = [`${prefix}files/`, `${prefix}derived/`];
  let objects: EbookListedObject[];
  try {
    objects = [...(await listEbookObjects(prefixes[0])), ...(await listEbookObjects(prefixes[1]))];
  } catch (error) {
    if (isNoSuchBucket(error)) return { bucket, missing: true as const };
    throw error;
  }
  const { unreferenced, inFlight } = await ebookOrphans(database, objects, now);
  return {
    bucket,
    prefixes,
    scanned: objects.length,
    inFlight: inFlight.length,
    orphans: unreferenced.length,
    totalBytes: unreferenced.reduce((sum, object) => sum + object.size, 0),
    objects: unreferenced.map((object) => ({ key: object.key, size: object.size, modified: object.lastModified?.toISOString() ?? null })),
  };
}

/** Run `work` over `items`, a few at once, in order of the results */
async function pooled<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(HEADS_AT_ONCE, items.length) }, async () => {
    while (next < items.length) {
      const at = next++;
      results[at] = await work(items[at]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Every file row against the bucket (listed here, unless the caller listed it). Reads only. */
export async function verifyEbookStorage(database: Db, now = Date.now(), listing?: EbookListedObject[]): Promise<VerifyReport> {
  const { bucket, prefix } = ebookStorage();
  const objects = listing ?? (await listEbookObjects(prefix));
  const listed = new Set(objects.map((o) => o.key));
  const rows = await database
    .select({ id: ebookFiles.id, s3Key: ebookFiles.s3Key, sha256: ebookFiles.sha256, sizeBytes: ebookFiles.sizeBytes, status: ebookFiles.status })
    .from(ebookFiles)
    .orderBy(ebookFiles.id);
  const checked = await pooled(rows, async (row): Promise<VerifiedRow> => {
    const base = { id: row.id, s3Key: row.s3Key, status: row.status, expectedSize: row.sizeBytes, expectedSha256: row.sha256 };
    if (!row.s3Key) return { ...base, outcome: "no-key", actualSize: null, actualSha256: null, checksum: null };
    const head = listed.has(row.s3Key) ? await headEbookObject(row.s3Key, { checksum: true }) : null;
    if (!head) return { ...base, outcome: "missing-object", actualSize: null, actualSha256: null, checksum: null };
    // A multipart upload's checksum is of its parts: S3 checked each part, and the metadata names the whole
    const actualSha256 = head.checksumType === "full" ? head.sha256 : head.metadataSha256;
    const outcome: VerifyOutcome =
      head.size !== row.sizeBytes ? "size-mismatch" : actualSha256 !== row.sha256 ? "checksum-mismatch" : "verified";
    return { ...base, outcome, actualSize: head.size, actualSha256, checksum: head.checksumType };
  });
  const { unreferenced, inFlight } = await ebookOrphans(database, objects, now);
  return { at: new Date(now), bucket, prefix, objectsListed: objects.length, rows: checked, unreferenced, inFlight };
}

/**
 * Marks what a report found: matches verified (with verified_at), objects
 * that are gone or differ missing. Quarantined and replaced files keep their
 * status. One atomic write per 500 rows.
 */
export async function applyEbookVerification(database: Db, report: VerifyReport) {
  const verified = report.rows.filter((r) => r.outcome === "verified" && ["stored", "verified", "missing"].includes(r.status)).map((r) => r.id);
  const missing = report.rows.filter((r) => r.outcome !== "verified" && ["stored", "verified"].includes(r.status)).map((r) => r.id);
  for (let at = 0; at < verified.length; at += ROWS_PER_WRITE) {
    const ids = verified.slice(at, at + ROWS_PER_WRITE);
    await atomicOn(database, (d) => [
      d.update(ebookFiles).set({ status: "verified", verifiedAt: report.at, updatedAt: report.at }).where(inArray(ebookFiles.id, ids)),
    ]);
  }
  for (let at = 0; at < missing.length; at += ROWS_PER_WRITE) {
    const ids = missing.slice(at, at + ROWS_PER_WRITE);
    await atomicOn(database, (d) => [
      d.update(ebookFiles).set({ status: "missing", updatedAt: report.at }).where(inArray(ebookFiles.id, ids)),
    ]);
  }
  return { verified: verified.length, missing: missing.length };
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The report as Markdown (counts) and CSV (one line per row and per unreferenced object) */
export function verificationReport(report: VerifyReport, applied?: { verified: number; missing: number }) {
  const count = (outcome: VerifyOutcome) => report.rows.filter((r) => r.outcome === outcome).length;
  const markdown = [
    `# eBook storage verification, ${report.at.toISOString()}`,
    "",
    `Bucket ${report.bucket}${report.prefix ? `, prefix ${report.prefix}` : ""}: ${report.objectsListed} objects listed, ${report.rows.length} file rows.`,
    applied ? `Applied: ${applied.verified} marked verified, ${applied.missing} marked missing.` : "Read-only: nothing was written.",
    "",
    "| Result | Count |",
    "|---|---|",
    `| Verified (size and SHA-256 match) | ${count("verified")} |`,
    `| Missing objects | ${count("missing-object")} |`,
    `| Size differs | ${count("size-mismatch")} |`,
    `| Checksum differs | ${count("checksum-mismatch")} |`,
    `| Rows with no key | ${count("no-key")} |`,
    `| Objects no row names (older than ${IN_FLIGHT_HOURS} hours) | ${report.unreferenced.length} |`,
    `| Objects no row names yet (in flight) | ${report.inFlight.length} |`,
    "",
  ].join("\n");
  const header = ["kind", "file_id", "key", "status", "outcome", "expected_size", "actual_size", "expected_sha256", "actual_sha256", "checksum", "last_modified"];
  const lines = [
    ...report.rows.map((r) => ["row", r.id, r.s3Key, r.status, r.outcome, r.expectedSize, r.actualSize, r.expectedSha256, r.actualSha256, r.checksum, null]),
    ...report.unreferenced.map((o) => ["unreferenced", null, o.key, null, null, null, o.size, null, null, null, o.lastModified]),
    ...report.inFlight.map((o) => ["in-flight", null, o.key, null, null, null, o.size, null, null, null, o.lastModified]),
  ];
  const csv = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n") + "\n";
  return { markdown, csv };
}

/**
 * `pnpm ebooks:verify`: plan (read-only), or apply with a pg_dump from the
 * last hour. Writes reports/ebooks/verify-<timestamp>.md and .csv.
 */
export async function runEbookVerification(options: { database: Db; apply: boolean; backup?: string; reportDir: string; host?: string; now?: number }) {
  if (options.apply && !recentBackup(options.backup, options.now))
    throw new Error("--apply needs --backup FILE: a pg_dump custom-format backup taken in the last hour");
  const report = await verifyEbookStorage(options.database, options.now);
  const applied = options.apply ? await applyEbookVerification(options.database, report) : undefined;
  if (applied) await recordVerification(options.database, report, applied, options.host ?? null);
  const { markdown, csv } = verificationReport(report, applied);
  const stamp = report.at.toISOString().replace(/[:.]/g, "-");
  mkdirSync(options.reportDir, { recursive: true });
  const files = { markdown: path.join(options.reportDir, `verify-${stamp}.md`), csv: path.join(options.reportDir, `verify-${stamp}.csv`) };
  writeFileSync(files.markdown, markdown);
  writeFileSync(files.csv, csv);
  return { report, applied, files };
}

/** An applied verification is a run on /ebooks/runs (SLN-494), with its counts */
async function recordVerification(database: Db, report: VerifyReport, applied: { verified: number; missing: number }, host: string | null) {
  const count = (outcome: VerifyOutcome) => report.rows.filter((r) => r.outcome === outcome).length;
  const finished = new Date();
  await database.insert(ebookIngestRuns).values({
    kind: "verify",
    state: "finished",
    host,
    toolVersion: VERIFY_TOOL_VERSION,
    counts: {
      verified: applied.verified,
      missing: applied.missing,
      differ: count("size-mismatch") + count("checksum-mismatch"),
      noKey: count("no-key"),
      unreferenced: report.unreferenced.length,
      inFlight: report.inFlight.length,
    },
    startedAt: report.at,
    finishedAt: finished,
    updatedAt: finished,
  });
}
