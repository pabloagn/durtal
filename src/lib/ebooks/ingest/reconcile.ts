import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { ebookFiles, ebookIngestItems } from "@/lib/db/schema";
import type { IngestReconciliation } from "@/lib/db/schema/ebook-ingest";
import { ebooksPrefix, parseStageKey } from "../keys";
import { listEbookInventory } from "../storage";
import { verifyEbookStorage, type VerifyOutcome } from "../verify";
import { walkRoots } from "./group";
import { HashCache } from "./hash";
import { pooled, sizeReason, sniffTaken, unreadable } from "./plan";
import { openFileSource } from "./source";

/*
 * The three sides of an ingestion (SLN-494), checked by checksum and size:
 * the files under the roots, the ebook_files rows and the bucket's objects.
 * Read-only. Ignored, DRM, quarantined and duplicate files are listed and
 * accounted for; a file not stored, a row whose object is missing or
 * differs, and an object no row names keep the reconciliation from being
 * exact. A row whose source file is gone from this host after its object
 * was verified is "no longer in the inbox", never an exception: the
 * verified object is the copy.
 */

type Exception = IngestReconciliation["exceptions"][number];

export interface ReconcileOptions {
  database: Db;
  roots: string[];
  host: string;
  cacheDir: string;
  includeText?: boolean;
  exclude?: string[];
  /** Only these files on disk (a trial's plan took only its first files) */
  paths?: string[];
  /** The apply this reconciliation ends: its failed and changed items are named with their reasons */
  runId?: string | null;
  now?: number;
}

const FILES_AT_ONCE = 4;

const ROW_REASONS: Record<Exclude<VerifyOutcome, "verified">, string> = {
  "missing-object": "Its object is missing from the bucket",
  "size-mismatch": "Its object's size differs from the row's",
  "checksum-mismatch": "Its object's checksum differs from the row's",
  "no-key": "The row names no object",
};

/** Reconciles the roots, the catalogue and the bucket. Writes nothing. */
export async function reconcileIngest(options: ReconcileOptions): Promise<IngestReconciliation> {
  const now = options.now ?? Date.now();
  const db = options.database;
  const exceptions: Exception[] = [];

  // In Neon: every file row, by checksum
  const rows = await db
    .select({
      id: ebookFiles.id,
      sha256: ebookFiles.sha256,
      status: ebookFiles.status,
      drm: ebookFiles.drm,
      s3Key: ebookFiles.s3Key,
      manifestKey: ebookFiles.manifestKey,
      coverKey: ebookFiles.coverKey,
      sourceHost: ebookFiles.sourceHost,
      sourcePath: ebookFiles.sourcePath,
      metadata: ebookFiles.metadata,
    })
    .from(ebookFiles);
  const bySha = new Map(rows.map((r) => [r.sha256, r]));

  // The run's own items: why a file it saw is not stored
  const items = options.runId
    ? await db
        .select({ path: ebookIngestItems.sourcePath, state: ebookIngestItems.state, outcome: ebookIngestItems.outcome, reason: ebookIngestItems.reason, lastError: ebookIngestItems.lastError })
        .from(ebookIngestItems)
        .where(eq(ebookIngestItems.runId, options.runId))
    : [];
  const itemByPath = new Map(items.map((i) => [i.path, i]));
  // A valid older publication cannot hide a failed operation in this run.
  for (const item of items) {
    if (item.state === "failed") exceptions.push({ side: "disk", kind: "failed", path: item.path, reason: item.lastError ?? "Failed", blocking: true });
    else if (item.outcome === "changed_since_plan") exceptions.push({ side: "disk", kind: "changed", path: item.path, reason: item.reason ?? "Changed since the plan: plan again to take it", blocking: true });
    else if (item.state !== "done") exceptions.push({ side: "disk", kind: "not-stored", path: item.path, reason: "Not finished by this run", blocking: true });
  }

  // On disk: every file under the roots, taken or not
  const walked = await walkRoots(options.roots, { exclude: options.exclude });
  const only = options.paths ? new Set(options.paths) : null;
  const files = only ? walked.files.filter((f) => only.has(f.path)) : walked.files;
  const sidecars = walked.sidecars;
  const hashes = new HashCache(options.cacheDir);
  const examined = await pooled(files, FILES_AT_ONCE, async (file) => {
    const tooBig = sizeReason(file.size);
    if (tooBig) return { path: file.path, sha256: null, reason: tooBig };
    try {
      const source = await openFileSource(file.path, file.name);
      try {
        const taken = await sniffTaken(source, { sidecar: sidecars.has(file.folder), includeText: !!options.includeText });
        if (taken.reason !== null) return { path: file.path, sha256: null, reason: taken.reason };
      } finally {
        await source.close();
      }
      return { path: file.path, sha256: (await hashes.hash(file.path)).sha256, reason: null };
    } catch (error) {
      return { path: file.path, sha256: null, reason: unreadable(error) };
    }
  });

  const firstPath = new Map<string, string>();
  for (const file of examined) {
    const runItem = itemByPath.get(file.path);
    if (runItem && (runItem.state !== "done" || runItem.outcome === "changed_since_plan")) continue;
    if (!file.sha256) {
      exceptions.push({ side: "disk", kind: "ignored", path: file.path, reason: file.reason ?? "Not taken", blocking: false });
      continue;
    }
    const row = bySha.get(file.sha256);
    const kept = firstPath.get(file.sha256);
    if (kept) {
      exceptions.push({ side: "disk", kind: "duplicate", path: file.path, reason: `Same bytes as ${kept}`, blocking: false });
      continue;
    }
    firstPath.set(file.sha256, file.path);
    if (row) {
      if (row.drm) exceptions.push({ side: "disk", kind: "drm", path: file.path, reason: `DRM (${row.drm}): stored, never opened`, blocking: false });
      if (row.status === "quarantined") {
        const problem = (row.metadata as { problem?: string } | null)?.problem;
        exceptions.push({ side: "disk", kind: "quarantined", path: file.path, reason: problem ?? "Quarantined: stored, never served", blocking: false });
      }
      continue;
    }
    const item = itemByPath.get(file.path);
    if (item?.outcome === "changed_since_plan")
      exceptions.push({ side: "disk", kind: "changed", path: file.path, reason: "Changed since the plan: plan again to take it", blocking: true });
    else exceptions.push({ side: "disk", kind: "not-stored", path: file.path, reason: "Not in the catalogue", blocking: true });
  }
  // In Neon and in S3: every row's object by size and checksum; every object a row names
  const objects = await listEbookInventory();
  const listed = new Set(objects.map((o) => o.key));
  const report = await verifyEbookStorage(db, now, objects);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  let noLongerInInbox = 0;
  for (const checked of report.rows) {
    const row = rowById.get(checked.id);
    const name = row?.sourcePath ?? checked.s3Key ?? checked.id;
    if (checked.outcome !== "verified") {
      exceptions.push({ side: "neon", kind: checked.outcome, path: name, reason: ROW_REASONS[checked.outcome], blocking: true });
      continue;
    }
    for (const [key, what] of [
      [row?.manifestKey, "manifest"],
      [row?.coverKey, "cover"],
    ] as const)
      if (key && !listed.has(key)) exceptions.push({ side: "neon", kind: "missing-derived", path: name, reason: `Its ${what} is missing from the bucket`, blocking: true });
    if (row?.sourceHost === options.host && row.sourcePath && !existsSync(row.sourcePath)) noLongerInInbox += 1;
  }
  const prefix = ebooksPrefix();
  for (const object of report.unreferenced)
    exceptions.push({ side: "s3", kind: "unreferenced", path: object.key.slice(prefix.length), reason: "No row names this object", blocking: true });

  return {
    at: new Date(now).toISOString(),
    host: options.host,
    roots: options.roots,
    onDisk: files.length,
    inNeon: rows.length,
    inS3: objects.filter((o) => o.key.startsWith(`${prefix}files/`) || parseStageKey(o.key)?.stage === "bronze").length,
    exact: !exceptions.some((e) => e.blocking),
    exceptions,
    noLongerInInbox,
    inFlight: report.inFlight.length,
  };
}
