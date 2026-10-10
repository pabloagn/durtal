import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import type { Db } from "@/lib/catalogue/work-store";
import { readUndoLog } from "@/lib/books/undo-file";
import { recentBackup } from "@/lib/enrichment/backup";
import { previewS3Dir } from "@/lib/s3/preview-dir";
import { withReadOnlyEbookStorage } from "../read-only-storage";
import { ebookStorage, ebookCredentialIdentity, isNoSuchBucket, listEbookInventory } from "../storage";
import { planIngest, type IngestPlan, type PlanOptions, type PlanTarget } from "./plan";
import { reconcileIngest, type ReconcileOptions } from "./reconcile";
import { undoIngest, type UndoEntry, type UndoResult } from "./register";
import { bucketMissingLine, planReport, reconcileReport } from "./report";

/*
 * What `pnpm ebooks:ingest` and `pnpm ebooks:reconcile` do around the
 * library (SLN-494): the inbox, the roots, the target the plan is made
 * against, and the report files. The library itself assumes no command
 * line, so the browser upload calls it as it is.
 */

/** Joris drops every e-book here; with no folder named, the command plans it */
export const INBOX_LABEL = "~/Downloads/eBooks";
export const inboxPath = () => path.join(homedir(), "Downloads", "eBooks");

/** The folders named, else the inbox; a missing one is a plain error */
export function resolveRoots(named: string[]): string[] {
  if (named.length === 0) {
    const inbox = inboxPath();
    if (!existsSync(inbox)) throw new Error(`${INBOX_LABEL} does not exist. Make it and drop the eBooks in, or name a folder.`);
    return [inbox];
  }
  return named.map((folder) => {
    const resolved = path.resolve(folder);
    if (!existsSync(resolved)) throw new Error(`${folder} does not exist.`);
    if (!statSync(resolved).isDirectory()) throw new Error(`${folder} is not a folder.`);
    return resolved;
  });
}

/** The machine's name, as runs record it ("Pablos-MacBook-Pro") */
export const machineName = () => hostname().replace(/\.local$/i, "");

/** A database's host, port and name, hashed: a plan names its target without its credentials */
export function databaseFingerprint(url: string): string {
  const u = new URL(url);
  return createHash("sha256")
    .update(`${u.hostname}:${u.port || "5432"}${u.pathname}`)
    .digest("hex")
    .slice(0, 16);
}

/** A database on this machine: a preview or a test container, never the live one */
export function isLocalDatabase(url: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(url).hostname);
}

/** The database and bucket a plan is made against */
export function currentTarget(databaseUrl: string): PlanTarget {
  const { bucket, prefix, region } = ebookStorage();
  return { database: databaseFingerprint(databaseUrl), bucket, prefix,
    region,
    credentialIdentity: ebookCredentialIdentity(),
    preview: !!previewS3Dir(),
    previewRoot: previewS3Dir(),
  };
}

const stampOf = (at: string) => at.replace(/[:.]/g, "-");

/**
 * Plans the roots and writes reports/ebooks/ingest-<timestamp>.md, .csv and
 * .plan.json. The database must be a read-only session; the bucket is only
 * listed. Before the AWS setup the bucket does not exist: the plan is made as
 * for an empty one, and says so.
 */
export async function planCommand(options: Omit<PlanOptions, "storedKeys"> & { roots: string[]; reportDir: string }) {
  return withReadOnlyEbookStorage(async () => {
    let bucketMissing = false;
    const storedKeys = new Set<string>();
    try {
      for (const object of await listEbookInventory()) storedKeys.add(object.key);
    } catch (error) {
      if (!isNoSuchBucket(error)) throw error;
      bucketMissing = true;
    }
    const plan = await planIngest(options.roots, { ...options, storedKeys });
    mkdirSync(options.reportDir, { recursive: true });
    const base = path.join(options.reportDir, `ingest-${stampOf(plan.createdAt)}`);
    const files = { markdown: `${base}.md`, csv: `${base}.csv`, plan: `${base}.plan.json` };
    const { markdown, csv } = planReport(plan, files.plan, { bucketMissing });
    writeFileSync(files.plan, JSON.stringify(plan));
    writeFileSync(files.markdown, markdown);
    writeFileSync(files.csv, csv);
    return { plan, files, notSetUp: bucketMissing ? bucketMissingLine(plan.target.bucket) : null };
  });
}

/** One line for the terminal */
export function planLine(plan: IngestPlan): string {
  const s = plan.summary;
  const ignored = Object.values(s.ignored).reduce((a, b) => a + b, 0);
  return (
    `${s.found} files: ${s.ebooksToCreate} new eBooks, ${s.formatsToAdd} formats to add, ${s.changed} changed, ` +
    `${s.alreadyStored} already stored, ${s.duplicates} duplicates, ${s.quarantined.length} quarantined, ${ignored} ignored.`
  );
}

/** Reconciles and writes reports/ebooks/reconcile-<timestamp>.md. Reads only. */
export async function reconcileCommand(options: ReconcileOptions & { reportDir: string }) {
  return withReadOnlyEbookStorage(async () => {
    const reconciliation = await reconcileIngest(options);
    mkdirSync(options.reportDir, { recursive: true });
    const file = path.join(options.reportDir, `reconcile-${stampOf(reconciliation.at)}.md`);
    writeFileSync(file, reconcileReport(reconciliation));
    return { reconciliation, file };
  });
}

export interface UndoHeader {
  runId: string;
  planSha256: string;
  createdAt: string;
}

/** `--undo FILE`: the rows the run created that nothing has changed since; never an S3 object */
export async function undoCommand(options: {
  database: Db;
  undoFile: string;
  backup?: string;
  live: boolean;
  localDatabase: boolean;
  now?: number;
}): Promise<UndoResult & { runId: string }> {
  if (!existsSync(options.undoFile)) throw new Error(`${options.undoFile} does not exist. Nothing written.`);
  if (!recentBackup(options.backup, options.now)) throw new Error("--undo needs --backup FILE: a pg_dump custom-format backup taken in the last hour. Nothing written.");
  if (!options.localDatabase && !options.live) throw new Error("This database is not a local preview: an undo of it needs --live. Nothing written.");
  const { header, entries } = readUndoLog<UndoHeader, UndoEntry>(options.undoFile);
  if (!header.runId || !header.planSha256) throw new Error(`${options.undoFile} is not an ingestion's undo file. Nothing written.`);
  return { runId: header.runId, ...(await undoIngest(options.database, entries)) };
}
