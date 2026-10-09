/** Executed only by the reviewed manifest wrapper, after separate approval. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { Db } from "../../src/lib/catalogue/work-store";

interface Manifest {
  version: number;
  mode: string;
  source: { commit: string; tree: string; packageLockSha256: string };
  reportDir: string;
  originalFiles: string[];
  inputs: { files: { path: string; bytes: number; mtimeNs: string; sha256: string }[] };
  databaseFingerprint: string;
  databaseUrlSha256: string;
  envDir: string;
  evidence: Record<string, { path: string; sha256: string }>;
  reviewedObjects: { Key: string; Size: number; ETag: string; LastModified: string }[];
  reviewedDownloads: { key: string; bytes: number; sha256: string; verified: boolean }[];
  legacyPrefix: string;
  objectKeys: string[];
  includeText: boolean;
  aws: { profile: string; account: string; region: string; bucket: string };
  commands: string[];
  limits: { objects: number; downloadBytes: number; requests: number; databaseRows: number; databaseBytes: number; seconds: number };
}
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const ROOT = path.resolve(import.meta.dirname, "../..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const resultRows = <T>(result: unknown): T[] => Array.isArray(result) ? result as T[] : (result as { rows: T[] }).rows;
const fixedCommands = ["ListObjectsV2Command", "HeadObjectCommand", "GetObjectCommand"];

async function main() {
  const { values } = parseArgs({ options: { "execute-reviewed-manifest": { type: "string" }, "manifest-sha256": { type: "string" } } });
  if (!values["execute-reviewed-manifest"] || !values["manifest-sha256"]) throw new Error("Reviewed manifest required");
  const raw = readFileSync(values["execute-reviewed-manifest"]);
  if (hash(raw) !== values["manifest-sha256"]) throw new Error("Manifest changed");
  const manifest = JSON.parse(raw.toString()) as Manifest;
  const sourceGuard = () => {
    const status = git("status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean);
    if (git("rev-parse", "HEAD") !== manifest.source.commit || git("rev-parse", "HEAD^{tree}") !== manifest.source.tree ||
        hash(readFileSync(path.join(ROOT, "pnpm-lock.yaml"))) !== manifest.source.packageLockSha256 ||
        status.some((line) => line !== "?? node_modules")) throw new Error("Source changed");
  };
  sourceGuard();
  if (manifest.version !== 1 || manifest.mode !== "pooled" || manifest.originalFiles.length !== 3 || manifest.inputs.files.length !== 3 ||
      manifest.objectKeys.length !== 21 || new Set(manifest.objectKeys).size !== 21 ||
      manifest.aws.profile !== "durtal-personal" || manifest.aws.account !== "608240934043" ||
      manifest.aws.region !== "eu-north-1" || manifest.aws.bucket !== "durtal" ||
      JSON.stringify(manifest.commands) !== JSON.stringify(fixedCommands)) throw new Error("Unexpected proof configuration");
  if (manifest.envDir !== "/Users/pabloaguirre/personal/durtal") throw new Error("Private config location changed");
  const privateUrl = () => {
    const base = dotenv.parse(readFileSync(path.join(manifest.envDir, ".env")));
    const local = dotenv.parse(readFileSync(path.join(manifest.envDir, ".env.local")));
    const value = local.DATABASE_URL ?? base.DATABASE_URL;
    if (!value || hash(value) !== manifest.databaseUrlSha256) throw new Error("Original pooled URL changed");
    return value;
  };
  const url = privateUrl();
  process.env.DATABASE_URL = url;
  for (const item of Object.values(manifest.evidence)) if (hash(readFileSync(item.path)) !== item.sha256) throw new Error("Reviewed evidence changed");
  const endpoint = new URL(url);
  if (!endpoint.hostname.endsWith(".neon.tech") || !endpoint.hostname.includes("-pooler.") ||
      !["postgres:", "postgresql:"].includes(endpoint.protocol) ||
      !["require", "verify-full"].includes(endpoint.searchParams.get("sslmode") ?? "")) throw new Error("Original TLS Neon pooler required");
  const fingerprint = hash(`${endpoint.hostname}:${endpoint.port || "5432"}${endpoint.pathname}`).slice(0, 16);
  if (fingerprint !== manifest.databaseFingerprint) throw new Error("Pooled endpoint changed");
  if (path.resolve(manifest.reportDir).startsWith(`${ROOT}${path.sep}`)) throw new Error("Evidence must be outside source");
  const report = manifest.reportDir;
  const save = (name: string, value: unknown) => writeFileSync(path.join(report, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const inputGuard = () => {
    for (const input of manifest.inputs.files) {
      const info = statSync(input.path, { bigint: true });
      if (Number(info.size) !== input.bytes || info.mtimeNs !== BigInt(input.mtimeNs) || hash(readFileSync(input.path)) !== input.sha256)
        throw new Error("Original input changed");
    }
  };
  inputGuard();
  const inputRoot = path.join(report, "inputs");
  const cacheDir = path.join(report, "cache");
  const planReports = path.join(report, "plan");
  for (const dir of [inputRoot, cacheDir, planReports]) mkdirSync(dir, { mode: 0o700 });
  // Preserve relative folders, basenames, bytes and mtime; originals are reads only.
  let common = path.dirname(manifest.originalFiles[0]);
  while (manifest.originalFiles.some((file) => path.relative(common, file).startsWith(".."))) common = path.dirname(common);
  for (const input of manifest.inputs.files) {
    const destination = path.join(inputRoot, path.relative(common, input.path));
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(input.path, destination);
    const original = statSync(input.path);
    utimesSync(destination, original.atime, original.mtime);
    if (hash(readFileSync(destination)) !== input.sha256) throw new Error("Input copy differs");
  }
  // No dotenv credentials or ambient credentials enter the SDK; initialization is explicit.
  for (const name of Object.keys(process.env)) if (name.startsWith("AWS_") || name.startsWith("EBOOK") || name.startsWith("DURTAL_")) delete process.env[name];
  Object.assign(process.env, { AWS_ACCESS_KEY_ID: "proof-no-ambient-key", AWS_SECRET_ACCESS_KEY: "proof-no-ambient-secret",
    EBOOKS_BUCKET: "durtal", EBOOKS_REGION: "eu-north-1", EBOOKS_PREFIX: manifest.legacyPrefix,
    EBOOKS_AWS_ACCOUNT_ID: "608240934043", EBOOK_DELIVERY: "app", NODE_ENV: "test" });
  const { initializePersonalSession } = await import("../ebooks/personal-session");
  const client = await initializePersonalSession("durtal-personal", undefined, "608240934043");
  client.config.maxAttempts = async () => 1;
  const { databaseErrorCode } = await import("../../src/lib/db/errors");
  const { withReadOnlyPlanningConnection } = await import("../../src/lib/enrichment/read-only-session");
  const { withReadOnlyEbookStorage } = await import("../../src/lib/ebooks/read-only-storage");
  const { currentTarget, machineName, planCommand } = await import("../../src/lib/ebooks/ingest/command");
  const prefixes = ["bronze/ebooks/", "silver/ebooks/", "gold/ebooks/", `${manifest.legacyPrefix}files/`, `${manifest.legacyPrefix}derived/`, `${manifest.legacyPrefix}staging/`];
  if (manifest.objectKeys.some((key) => !prefixes.some((prefix) => key.startsWith(prefix)))) throw new Error("Reviewed key outside eBook scope");
  let requests = 0;
  let getBudget = 0;
  const commands: Record<string, number> = {};
  const sizes = new Map<string, number>();
  const started = Date.now();
  const live = () => {
    if (Date.now() - started >= manifest.limits.seconds * 1000) throw new Error("Proof deadline exceeded");
    if (process.env.DATABASE_URL !== url) throw new Error("Original endpoint changed");
  };
  client.middlewareStack.add((next, context) => async (args) => {
    live();
    const command = context.commandName ?? "";
    const input = args.input as { Bucket?: string; ExpectedBucketOwner?: string; Key?: string; Prefix?: string; MaxKeys?: number };
    if (!fixedCommands.includes(command) || input.Bucket !== "durtal" || input.ExpectedBucketOwner !== "608240934043") throw new Error("AWS dispatch refused");
    if (++requests > manifest.limits.requests) throw new Error("AWS request bound exceeded");
    commands[command] = (commands[command] ?? 0) + 1;
    if (command === "ListObjectsV2Command") {
      if (!prefixes.includes(input.Prefix ?? "")) throw new Error("Listing outside reviewed eBook prefixes");
    } else if (!input.Key || !manifest.objectKeys.includes(input.Key)) throw new Error("Object outside reviewed 21-key scope");
    if (command === "GetObjectCommand") {
      const size = sizes.get(input.Key!);
      if (size === undefined || (getBudget += size) > manifest.limits.downloadBytes) throw new Error("GET byte bound exceeded");
    }
    return next(args);
  }, { step: "initialize", priority: "high", name: "sln494ProofBounds" });
  const base = { Bucket: "durtal", ExpectedBucketOwner: "608240934043" };
  const storageSnapshot = async () => {
    const objects = new Map<string, { key: string; size: number; etag: string | null; modified: string | null; storageClass: string | null }>();
    for (const prefix of prefixes) {
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ ...base, Prefix: prefix, MaxKeys: Math.min(1000, manifest.limits.objects + 1), ContinuationToken: token }));
        for (const object of page.Contents ?? []) {
          if (!object.Key || object.Size === undefined) throw new Error("Incomplete object listing");
          objects.set(object.Key, { key: object.Key, size: object.Size, etag: object.ETag ?? null, modified: object.LastModified?.toISOString() ?? null, storageClass: object.StorageClass ?? null });
          if (objects.size > manifest.limits.objects) throw new Error("Object bound exceeded");
        }
        if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === token)) throw new Error("Invalid listing continuation");
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    }
    const listed = [...objects.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    if (JSON.stringify(listed.map((object) => object.key)) !== JSON.stringify(manifest.objectKeys)) throw new Error("Original 21-object inventory differs");
    const result = [];
    for (const object of listed) {
      const approved = manifest.reviewedObjects.find((item) => item.Key === object.key);
      if (!approved || approved.Size !== object.size || approved.ETag !== object.etag || new Date(approved.LastModified).toISOString() !== object.modified) throw new Error("Object differs from reviewed inventory");
      const head = await client.send(new HeadObjectCommand({ ...base, Key: object.key, ChecksumMode: "ENABLED" }));
      if (head.ContentLength !== object.size || head.ETag !== object.etag || !head.ETag) throw new Error("Object changed during snapshot");
      sizes.set(object.key, object.size);
      const get = await client.send(new GetObjectCommand({ ...base, Key: object.key, IfMatch: head.ETag }));
      if (!get.Body || get.ContentLength !== object.size) throw new Error("Incomplete object read");
      const checksum = createHash("sha256");
      let bytes = 0;
      for await (const chunk of get.Body as AsyncIterable<Uint8Array>) {
        live();
        bytes += chunk.byteLength;
        if (bytes > object.size) throw new Error("Object byte bound exceeded");
        checksum.update(chunk);
      }
      if (bytes !== object.size) throw new Error("Truncated object read");
      const { $metadata: _requestMetadata, ...metadata } = head;
      const sha256 = checksum.digest("hex");
      const verified = manifest.reviewedDownloads.find((item) => item.key === object.key);
      if (!verified?.verified || verified.bytes !== bytes || verified.sha256 !== sha256) throw new Error("Object bytes differ from original verified download");
      result.push({ ...object, head: metadata, sha256 });
    }
    return { prefixes, objects: result, sha256: hash(JSON.stringify(result)) };
  };
  const catalogueSnapshot = async (database: Db) => {
    const tables = resultRows<{ tablename: string }>(await database.execute(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`));
    if (tables.length > 300) throw new Error("Table bound exceeded");
    let totalRows = 0;
    let totalBytes = 0;
    const result = [];
    for (const { tablename } of tables) {
      live();
      const remainingRows = manifest.limits.databaseRows - totalRows;
      const remainingBytes = manifest.limits.databaseBytes - totalBytes;
      const [size] = resultRows<{ rows: string; bytes: string }>(await database.execute(sql`select count(*)::text as rows, coalesce(sum(octet_length(to_jsonb(t)::text)), 0)::text as bytes from ${sql.identifier("public")}.${sql.identifier(tablename)} t`));
      if (Number(size.rows) > remainingRows || Number(size.bytes) > remainingBytes) throw new Error("Database snapshot bound exceeded");
      const rows = resultRows<{ row: string | null }>(await database.execute(sql`select case when sum(octet_length(to_jsonb(t)::text)) over () <= ${remainingBytes} then to_jsonb(t)::text else null end as row from ${sql.identifier("public")}.${sql.identifier(tablename)} t limit ${remainingRows + 1}`));
      totalRows += rows.length;
      if (totalRows > manifest.limits.databaseRows || rows.length !== Number(size.rows)) throw new Error("Database row bound exceeded or catalogue changed");
      const texts = rows.map(({ row }) => {
        if (row === null) throw new Error("Database byte bound exceeded");
        totalBytes += Buffer.byteLength(row);
        if (totalBytes > manifest.limits.databaseBytes) throw new Error("Database byte bound exceeded");
        return row;
      }).sort();
      // Only hashes/counts leave memory; this includes every column and duplicate.
      const checksum = createHash("sha256");
      for (const text of texts) checksum.update(`${Buffer.byteLength(text)}:${text}`);
      result.push({ table: tablename, rows: texts.length, sha256: checksum.digest("hex") });
    }
    return { tables: result, rows: totalRows, bytes: totalBytes, sha256: hash(JSON.stringify(result)) };
  };
  const connectionProofs: unknown[] = [];
  const read = <T>(work: (database: Db) => Promise<T>) => withReadOnlyPlanningConnection(url, async (database) => {
    await database.execute(sql`select set_config('statement_timeout', '15000', true), set_config('lock_timeout', '3000', true)`);
    const proof = resultRows<{ read_only: string; backend: number }>(await database.execute(sql`select current_setting('transaction_read_only') as read_only, pg_backend_pid() as backend`));
    if (proof[0]?.read_only !== "on") throw new Error("Transaction setting changed");
    const probeCode = await database.transaction((transaction) => transaction.execute(sql`update works set updated_at = updated_at where false`)).then(() => null, (error: unknown) => databaseErrorCode(error));
    if (probeCode !== "25006") throw new Error("Savepoint probe did not refuse a write");
    const after = resultRows<{ read_only: string; backend: number }>(await database.execute(sql`select current_setting('transaction_read_only') as read_only, pg_backend_pid() as backend`));
    if (after[0]?.read_only !== "on" || after[0]?.backend !== proof[0]?.backend) throw new Error("Protected backend changed");
    connectionProofs.push({ before: proof[0], probeCode, after: after[0] });
    return work(database);
  });
  let status = "failed";
  try {
    await withReadOnlyEbookStorage(async () => {
      const before = { catalogue: await read(catalogueSnapshot), storage: await storageSnapshot() };
      save("before.json", before);
      let planningSucceeded = false;
      try {
        const planned = await read((database) => planCommand({ database, roots: [inputRoot], host: machineName(), target: currentTarget(url), cacheDir, reportDir: planReports, includeText: manifest.includeText }));
        if (planned.notSetUp || planned.plan.summary.found !== 3 || planned.plan.target.database !== manifest.databaseFingerprint) throw new Error("Plan differs from the reviewed three-file scope");
        save("plan-summary.json", { files: planned.files, summary: planned.plan.summary, planSha256: hash(readFileSync(planned.files.plan)) });
        planningSucceeded = true;
      } catch {
        save("plan-failed.json", { status: "failed", reason: "Planning failed; private diagnostics withheld" });
      }
      const after = { catalogue: await read(catalogueSnapshot), storage: await storageSnapshot() };
      save("after.json", after);
      inputGuard();
      privateUrl();
      sourceGuard();
      if (before.catalogue.sha256 !== after.catalogue.sha256 || before.storage.sha256 !== after.storage.sha256) throw new Error("Catalogue or object inventory changed");
      if (!planningSucceeded) throw new Error("Planning did not complete");
      status = "passed";
    });
  } finally {
    save("pooled-result.json", { status, manifestSha256: values["manifest-sha256"], source: manifest.source, databaseFingerprint: fingerprint,
      aws: manifest.aws, inventoryKeys: manifest.objectKeys, connectionProofs, commands, requests, getBudgetBytes: getBudget,
      elapsedSeconds: (Date.now() - started) / 1000, failedWriteProbe: "shared guard requires savepoint SQLSTATE 25006 before every callback" });
    client.destroy();
  }
}

try { await main(); }
catch { process.exitCode = 1; } // URL, catalogue values and credential output stay private.
