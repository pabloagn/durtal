/** Executed only by the reviewed manifest wrapper, after separate approval. */
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { parseArgs, promisify } from "node:util";
import {
  collectProof,
  ProofBudget,
  readPrivateTarget,
  type Phase,
  type CleanupReserve,
} from "./ebook-proof-control";
import { sql } from "drizzle-orm";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { Db } from "../../src/lib/catalogue/work-store";

interface Manifest {
  version: number;
  mode: string;
  source: { commit: string; tree: string; packageLockSha256: string };
  reportDir: string;
  originalFiles: string[];
  inputs: {
    files: { path: string; bytes: number; mtimeNs: string; sha256: string }[];
  };
  databaseFingerprint: string;
  databaseUrlSha256: string;
  envDir: string;
  evidence: Record<string, { path: string; sha256: string }>;
  reviewedObjects: {
    Key: string;
    Size: number;
    ETag: string;
    LastModified: string;
  }[];
  reviewedDownloads: {
    key: string;
    bytes: number;
    sha256: string;
    verified: boolean;
  }[];
  legacyPrefix: string;
  objectKeys: string[];
  includeText: boolean;
  aws: { profile: string; account: string; region: string; bucket: string };
  commands: string[];
  cleanupReserve: CleanupReserve;
  limits: {
    objects: number;
    downloadBytes: number;
    requests: number;
    databaseRows: number;
    databaseBytes: number;
    seconds: number;
  };
}
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const ROOT = path.resolve(import.meta.dirname, "../..");
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const resultRows = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : (result as { rows: T[] }).rows;
const fixedCommands = [
  "ListObjectsV2Command",
  "HeadObjectCommand",
  "GetObjectCommand",
];

async function main() {
  const { values } = parseArgs({
    options: {
      "execute-reviewed-manifest": { type: "string" },
      "manifest-sha256": { type: "string" },
      "hard-deadline-ms": { type: "string" },
    },
  });
  if (
    !values["execute-reviewed-manifest"] ||
    !values["manifest-sha256"] ||
    !values["hard-deadline-ms"]
  )
    throw new Error("Reviewed manifest required");
  const raw = readFileSync(values["execute-reviewed-manifest"]);
  if (hash(raw) !== values["manifest-sha256"])
    throw new Error("Manifest changed");
  const manifest = JSON.parse(raw.toString()) as Manifest;
  const sourceGuard = () => {
    const status = git("status", "--porcelain", "--untracked-files=all")
      .split("\n")
      .filter(Boolean);
    if (
      git("rev-parse", "HEAD") !== manifest.source.commit ||
      git("rev-parse", "HEAD^{tree}") !== manifest.source.tree ||
      hash(readFileSync(path.join(ROOT, "pnpm-lock.yaml"))) !==
        manifest.source.packageLockSha256 ||
      status.some((line) => line !== "?? node_modules")
    )
      throw new Error("Source changed");
  };
  sourceGuard();
  if (
    manifest.version !== 1 ||
    manifest.mode !== "pooled" ||
    manifest.originalFiles.length !== 3 ||
    manifest.inputs.files.length !== 3 ||
    manifest.objectKeys.length !== 21 ||
    new Set(manifest.objectKeys).size !== 21 ||
    manifest.aws.profile !== "durtal-personal" ||
    manifest.aws.account !== "608240934043" ||
    manifest.aws.region !== "eu-north-1" ||
    manifest.aws.bucket !== "durtal" ||
    JSON.stringify(manifest.commands) !== JSON.stringify(fixedCommands)
  )
    throw new Error("Unexpected proof configuration");
  if (manifest.envDir !== "/Users/pabloaguirre/personal/durtal")
    throw new Error("Private config location changed");
  const privateUrl = () =>
    readPrivateTarget(manifest.envDir, manifest.databaseUrlSha256);
  const { url, fingerprint } = privateUrl();
  process.env.DATABASE_URL = url;
  for (const item of Object.values(manifest.evidence))
    if (hash(readFileSync(item.path)) !== item.sha256)
      throw new Error("Reviewed evidence changed");
  if (fingerprint !== manifest.databaseFingerprint)
    throw new Error("Live pooled target differs");
  if (path.resolve(manifest.reportDir).startsWith(`${ROOT}${path.sep}`))
    throw new Error("Evidence must be outside source");
  const report = manifest.reportDir;
  const save = (name: string, value: unknown) =>
    writeFileSync(
      path.join(report, name),
      JSON.stringify(value, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  const inputGuard = () => {
    for (const input of manifest.inputs.files) {
      const info = statSync(input.path, { bigint: true });
      if (
        Number(info.size) !== input.bytes ||
        info.mtimeNs !== BigInt(input.mtimeNs) ||
        hash(readFileSync(input.path)) !== input.sha256
      )
        throw new Error("Original input changed");
    }
  };
  inputGuard();
  const inputRoot = path.join(report, "inputs");
  const cacheDir = path.join(report, "cache");
  const planReports = path.join(report, "plan");
  for (const dir of [inputRoot, cacheDir, planReports])
    mkdirSync(dir, { mode: 0o700 });
  // Preserve relative folders, basenames, bytes and mtime; originals are reads only.
  let common = path.dirname(manifest.originalFiles[0]);
  while (
    manifest.originalFiles.some((file) =>
      path.relative(common, file).startsWith(".."),
    )
  )
    common = path.dirname(common);
  for (const input of manifest.inputs.files) {
    const destination = path.join(inputRoot, path.relative(common, input.path));
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(input.path, destination);
    const original = statSync(input.path);
    utimesSync(destination, original.atime, original.mtime);
    if (hash(readFileSync(destination)) !== input.sha256)
      throw new Error("Input copy differs");
  }
  // No dotenv credentials or ambient credentials enter the SDK; initialization is explicit.
  for (const name of Object.keys(process.env))
    if (
      name.startsWith("AWS_") ||
      name.startsWith("EBOOK") ||
      name.startsWith("DURTAL_")
    )
      delete process.env[name];
  Object.assign(process.env, {
    AWS_ACCESS_KEY_ID: "proof-no-ambient-key",
    AWS_SECRET_ACCESS_KEY: "proof-no-ambient-secret",
    EBOOKS_BUCKET: "durtal",
    EBOOKS_REGION: "eu-north-1",
    EBOOKS_PREFIX: manifest.legacyPrefix,
    EBOOKS_AWS_ACCOUNT_ID: "608240934043",
    EBOOK_DELIVERY: "app",
    NODE_ENV: "test",
  });
  const hardDeadline = Number(values["hard-deadline-ms"]);
  if (!Number.isFinite(hardDeadline))
    throw new Error("Wrapper deadline required");
  const budget = new ProofBudget(
    manifest.limits,
    manifest.cleanupReserve,
    hardDeadline,
  );
  const scope = new AsyncLocalStorage<Phase>();
  const stopped = () => budget.stopWork();
  process.on("SIGTERM", stopped);
  process.on("SIGINT", stopped);
  let initializedClient: S3Client | undefined;
  try {
    const {
      initializePersonalSession,
      assertPersonalReadCommand,
      personalAwsEnvironment,
    } = await import("../ebooks/personal-session");
    const cliCommands: Record<string, number> = {};
    const runAws = async (args: string[]) => {
      assertPersonalReadCommand(args);
      const phase = scope.getStore();
      if (!phase) throw new Error("Missing operation scope");
      budget.charge(phase);
      const label = args.slice(0, 2).join(" ");
      cliCommands[label] = (cliCommands[label] ?? 0) + 1;
      const result = await promisify(execFile)(
        "aws",
        [
          ...args,
          "--profile",
          "durtal-personal",
          "--region",
          "eu-north-1",
          "--no-cli-pager",
        ],
        {
          env: personalAwsEnvironment(),
          maxBuffer: 1024 * 1024,
          timeout: 5000,
          signal: budget.signal(phase),
        },
      );
      return result.stdout;
    };
    const client = await scope.run("work", () =>
      budget.bounded("work", () =>
        initializePersonalSession("durtal-personal", runAws, "608240934043"),
      ),
    );
    initializedClient = client;
    client.config.maxAttempts = async () => 1;
    const handler = client.config.requestHandler as unknown as {
      updateHttpClientConfig?: (key: string, value: number) => void;
    };
    if (typeof handler.updateHttpClientConfig !== "function")
      throw new Error("Bounded HTTP handler required");
    handler.updateHttpClientConfig("requestTimeout", 15000);
    handler.updateHttpClientConfig("connectionTimeout", 5000);
    const { databaseErrorCode } = await import("../../src/lib/db/errors");
    const { withReadOnlyPlanningConnection } =
      await import("../../src/lib/enrichment/read-only-session");
    const { withReadOnlyEbookStorage } =
      await import("../../src/lib/ebooks/read-only-storage");
    const { currentTarget, machineName, planCommand } =
      await import("../../src/lib/ebooks/ingest/command");
    const prefixes = [
      "bronze/ebooks/",
      "silver/ebooks/",
      "gold/ebooks/",
      `${manifest.legacyPrefix}files/`,
      `${manifest.legacyPrefix}derived/`,
      `${manifest.legacyPrefix}staging/`,
    ];
    if (
      manifest.objectKeys.some(
        (key) => !prefixes.some((prefix) => key.startsWith(prefix)),
      )
    )
      throw new Error("Reviewed key outside eBook scope");
    const commands: Record<string, number> = {};
    const sizes = new Map<string, number>();
    const started = Date.now();
    const live = () => {
      const phase = scope.getStore();
      if (!phase) throw new Error("Missing operation scope");
      budget.check(phase);
      if (process.env.DATABASE_URL !== url)
        throw new Error("Original endpoint changed");
    };
    client.middlewareStack.add(
      (next, context) => async (args) => {
        live();
        const command = context.commandName ?? "";
        const input = args.input as {
          Bucket?: string;
          ExpectedBucketOwner?: string;
          Key?: string;
          Prefix?: string;
          MaxKeys?: number;
        };
        if (
          !fixedCommands.includes(command) ||
          input.Bucket !== "durtal" ||
          input.ExpectedBucketOwner !== "608240934043"
        )
          throw new Error("AWS dispatch refused");
        if (command === "ListObjectsV2Command") {
          if (!prefixes.includes(input.Prefix ?? ""))
            throw new Error("Listing outside reviewed eBook prefixes");
        } else if (!input.Key || !manifest.objectKeys.includes(input.Key))
          throw new Error("Object outside reviewed 21-key scope");
        const size = command === "GetObjectCommand" ? sizes.get(input.Key!) : 0;
        if (size === undefined) throw new Error("Unknown GET size");
        const phase = scope.getStore()!;
        budget.charge(phase, size);
        commands[command] = (commands[command] ?? 0) + 1;
        return next(args);
      },
      { step: "initialize", priority: "high", name: "sln494ProofBounds" },
    );
    const base = { Bucket: "durtal", ExpectedBucketOwner: "608240934043" };
    const storageSnapshot = async (phase: Phase) =>
      scope.run(phase, async () => {
        const objects = new Map<
          string,
          {
            key: string;
            size: number;
            etag: string | null;
            modified: string | null;
            storageClass: string | null;
          }
        >();
        for (const prefix of prefixes) {
          let token: string | undefined;
          do {
            const page = await client.send(
              new ListObjectsV2Command({
                ...base,
                Prefix: prefix,
                MaxKeys: Math.min(1000, manifest.limits.objects + 1),
                ContinuationToken: token,
              }),
              { abortSignal: budget.signal(phase) },
            );
            for (const object of page.Contents ?? []) {
              if (!object.Key || object.Size === undefined)
                throw new Error("Incomplete object listing");
              objects.set(object.Key, {
                key: object.Key,
                size: object.Size,
                etag: object.ETag ?? null,
                modified: object.LastModified?.toISOString() ?? null,
                storageClass: object.StorageClass ?? null,
              });
              if (objects.size > manifest.limits.objects)
                throw new Error("Object bound exceeded");
            }
            if (
              page.IsTruncated &&
              (!page.NextContinuationToken ||
                page.NextContinuationToken === token)
            )
              throw new Error("Invalid listing continuation");
            token = page.IsTruncated ? page.NextContinuationToken : undefined;
          } while (token);
        }
        const listed = [...objects.values()].sort((a, b) =>
          a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
        );
        if (
          JSON.stringify(listed.map((object) => object.key)) !==
          JSON.stringify(manifest.objectKeys)
        )
          throw new Error("Original 21-object inventory differs");
        const result = [];
        for (const object of listed) {
          const approved = manifest.reviewedObjects.find(
            (item) => item.Key === object.key,
          );
          if (
            !approved ||
            approved.Size !== object.size ||
            approved.ETag !== object.etag ||
            new Date(approved.LastModified).toISOString() !== object.modified
          )
            throw new Error("Object differs from reviewed inventory");
          const head = await client.send(
            new HeadObjectCommand({
              ...base,
              Key: object.key,
              ChecksumMode: "ENABLED",
            }),
            { abortSignal: budget.signal(phase) },
          );
          if (
            head.ContentLength !== object.size ||
            head.ETag !== object.etag ||
            !head.ETag
          )
            throw new Error("Object changed during snapshot");
          sizes.set(object.key, object.size);
          const get = await client.send(
            new GetObjectCommand({
              ...base,
              Key: object.key,
              IfMatch: head.ETag,
            }),
            { abortSignal: budget.signal(phase) },
          );
          if (!get.Body || get.ContentLength !== object.size)
            throw new Error("Incomplete object read");
          const checksum = createHash("sha256");
          let bytes = 0;
          for await (const chunk of get.Body as AsyncIterable<Uint8Array>) {
            live();
            bytes += chunk.byteLength;
            if (bytes > object.size)
              throw new Error("Object byte bound exceeded");
            checksum.update(chunk);
          }
          if (bytes !== object.size) throw new Error("Truncated object read");
          const { $metadata: _requestMetadata, ...metadata } = head;
          const sha256 = checksum.digest("hex");
          const verified = manifest.reviewedDownloads.find(
            (item) => item.key === object.key,
          );
          if (
            !verified?.verified ||
            verified.bytes !== bytes ||
            verified.sha256 !== sha256
          )
            throw new Error(
              "Object bytes differ from original verified download",
            );
          result.push({ ...object, head: metadata, sha256 });
        }
        return {
          prefixes,
          objects: result,
          sha256: hash(JSON.stringify(result)),
        };
      });
    const catalogueSnapshot = async (database: Db) => {
      const tables = resultRows<{ tablename: string }>(
        await database.execute(
          sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
        ),
      );
      if (tables.length > 300) throw new Error("Table bound exceeded");
      let totalRows = 0;
      let totalBytes = 0;
      const result = [];
      for (const { tablename } of tables) {
        live();
        const remainingRows = manifest.limits.databaseRows - totalRows;
        const remainingBytes = manifest.limits.databaseBytes - totalBytes;
        const [size] = resultRows<{ rows: string; bytes: string }>(
          await database.execute(
            sql`select count(*)::text as rows, coalesce(sum(octet_length(to_jsonb(t)::text)), 0)::text as bytes from ${sql.identifier("public")}.${sql.identifier(tablename)} t`,
          ),
        );
        if (
          Number(size.rows) > remainingRows ||
          Number(size.bytes) > remainingBytes
        )
          throw new Error("Database snapshot bound exceeded");
        const rows = resultRows<{ row: string | null }>(
          await database.execute(
            sql`select case when sum(octet_length(to_jsonb(t)::text)) over () <= ${remainingBytes} then to_jsonb(t)::text else null end as row from ${sql.identifier("public")}.${sql.identifier(tablename)} t limit ${remainingRows + 1}`,
          ),
        );
        totalRows += rows.length;
        if (
          totalRows > manifest.limits.databaseRows ||
          rows.length !== Number(size.rows)
        )
          throw new Error("Database row bound exceeded or catalogue changed");
        const texts = rows
          .map(({ row }) => {
            if (row === null) throw new Error("Database byte bound exceeded");
            totalBytes += Buffer.byteLength(row);
            if (totalBytes > manifest.limits.databaseBytes)
              throw new Error("Database byte bound exceeded");
            return row;
          })
          .sort();
        // Only hashes/counts leave memory; this includes every column and duplicate.
        const checksum = createHash("sha256");
        for (const text of texts)
          checksum.update(`${Buffer.byteLength(text)}:${text}`);
        result.push({
          table: tablename,
          rows: texts.length,
          sha256: checksum.digest("hex"),
        });
      }
      return {
        tables: result,
        rows: totalRows,
        bytes: totalBytes,
        sha256: hash(JSON.stringify(result)),
      };
    };
    const connectionProofs: unknown[] = [];
    const read = <T>(phase: Phase, work: (database: Db) => Promise<T>) =>
      scope.run(phase, () =>
        budget.bounded(phase, () =>
          withReadOnlyPlanningConnection(url, async (database) => {
            live();
            await database.execute(
              sql`select set_config('statement_timeout', '15000', true), set_config('lock_timeout', '3000', true)`,
            );
            const proof = resultRows<{ read_only: string; backend: number }>(
              await database.execute(
                sql`select current_setting('transaction_read_only') as read_only, pg_backend_pid() as backend`,
              ),
            );
            if (proof[0]?.read_only !== "on")
              throw new Error("Transaction setting changed");
            const probeCode = await database
              .transaction((transaction) =>
                transaction.execute(
                  sql`update works set updated_at = updated_at where false`,
                ),
              )
              .then(
                () => null,
                (error: unknown) => databaseErrorCode(error),
              );
            if (probeCode !== "25006")
              throw new Error("Savepoint probe did not refuse a write");
            const after = resultRows<{ read_only: string; backend: number }>(
              await database.execute(
                sql`select current_setting('transaction_read_only') as read_only, pg_backend_pid() as backend`,
              ),
            );
            if (
              after[0]?.read_only !== "on" ||
              after[0]?.backend !== proof[0]?.backend
            )
              throw new Error("Protected backend changed");
            connectionProofs.push({
              before: proof[0],
              probeCode,
              after: after[0],
            });
            live();
            return work(database);
          }),
        ),
      );
    const proof = await withReadOnlyEbookStorage(() =>
      collectProof({
        budget,
        catalogue: (phase) => read(phase, catalogueSnapshot),
        storage: storageSnapshot,
        plan: () =>
          read("work", async (database) => {
            const planned = await planCommand({
              database,
              roots: [inputRoot],
              host: machineName(),
              target: currentTarget(url),
              cacheDir,
              reportDir: planReports,
              includeText: manifest.includeText,
            });
            live();
            if (
              planned.notSetUp ||
              planned.plan.summary.found !== 3 ||
              planned.plan.target.database !== manifest.databaseFingerprint
            )
              throw new Error(
                "Plan differs from the reviewed three-file scope",
              );
            return {
              files: planned.files,
              summary: planned.plan.summary,
              planSha256: hash(readFileSync(planned.files.plan)),
            };
          }),
        finalGuards: () => {
          inputGuard();
          privateUrl();
          sourceGuard();
        },
        onSnapshot: (phase, snapshot) => {
          const name = phase === "work" ? "before" : "after";
          const pending = path.join(report, `${name}.pending.json`);
          writeFileSync(pending, JSON.stringify(snapshot, null, 2) + "\n", {
            flag: "wx",
            mode: 0o600,
          });
          renameSync(pending, path.join(report, `${name}.json`));
        },
      }),
    );
    if (proof.planned.status === "complete")
      save("plan-summary.json", proof.planned.value);
    save("pooled-result.json", {
      status: proof.status,
      evidenceComplete: proof.evidenceComplete,
      unchanged: proof.unchanged,
      zeroMutationVerified: proof.zeroMutationVerified,
      guards: proof.guards,
      planningStatus: proof.planned.status,
      manifestSha256: values["manifest-sha256"],
      source: manifest.source,
      databaseFingerprint: fingerprint,
      aws: manifest.aws,
      inventoryKeys: manifest.objectKeys,
      connectionProofs,
      commands,
      cliCommands,
      requests: budget.requests,
      getBudgetBytes: budget.downloadBytes,
      cleanupReserve: manifest.cleanupReserve,
      elapsedSeconds: (Date.now() - started) / 1000,
    });
    if (proof.status !== "passed") process.exitCode = 1;
  } finally {
    initializedClient?.destroy();
    budget.dispose();
    process.removeListener("SIGTERM", stopped);
    process.removeListener("SIGINT", stopped);
  }
}

try {
  await main();
} catch {
  process.exitCode = 1;
} // URL, catalogue values and credential output stay private.
