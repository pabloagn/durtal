/**
 * E-book ingestion (SLN-494), run on the machine that holds the files.
 *
 * - Plan (the default): `pnpm ebooks:ingest [<folder> ...]`. With no folder
 *   it plans the inbox, ~/Downloads/eBooks. Read-only: the catalogue through
 *   a session that refuses writes (a probe proves it first), the bucket's
 *   files/ keys listed once. Hashes, sniffs, inspects and extracts every
 *   candidate; covers and manifests go into the cache folder, so the apply
 *   uploads exactly what was planned. Writes reports/ebooks/ingest-<time>.md
 *   (summary), .csv (one row per file) and .plan.json (what the apply will
 *   write, with the inputs' fingerprints).
 * - `--apply <plan.json> --backup <dump>`: exactly that plan. Refuses a plan
 *   older than 7 days or made against another database or bucket, and a
 *   backup that is not a pg_dump custom file from the last hour. A database
 *   that is not a local preview also needs `--live` (the live apply waits for
 *   Joris's own yes). Ends with a reconciliation.
 * - `--resume <runId> --backup <dump>`: carries on with every item not done.
 * - `--undo <file> --backup <dump>`: removes the rows a run created that
 *   nothing has changed since; S3 objects stay.
 * - `--preview <port>`: a running preview's database and S3 folder.
 *
 * Durtal never moves, changes or deletes a file in the inbox or any folder.
 *
 *   pnpm ebooks:ingest [<folder> ...] [--limit N] [--include-text] [--exclude GLOB]...
 *     [--host LABEL] [--cache-dir DIR] [--report-dir DIR] [--preview PORT] [--env-dir DIR]
 *   pnpm ebooks:ingest --apply PLAN --backup DUMP [--live]
 *   pnpm ebooks:ingest --resume RUN_ID --backup DUMP [--live]
 *   pnpm ebooks:ingest --undo FILE --backup DUMP [--live]
 */
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadEnvironment } from "./environment";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: "string" },
    resume: { type: "string" },
    undo: { type: "string" },
    backup: { type: "string" },
    live: { type: "boolean", default: false },
    limit: { type: "string" },
    "include-text": { type: "boolean", default: false },
    exclude: { type: "string", multiple: true },
    host: { type: "string" },
    "cache-dir": { type: "string", default: resolve(homedir(), ".cache/durtal-ebooks") },
    "report-dir": { type: "string", default: "reports/ebooks" },
    preview: { type: "string" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
const modes = [values.apply, values.resume, values.undo].filter(Boolean).length;
if (modes > 1) throw new Error("Give one of --apply, --resume and --undo");
if (modes === 1 && positionals.length) throw new Error("Folders are planned; --apply, --resume and --undo take the plan, run or undo file only");
const limit = values.limit ? Number(values.limit) : undefined;
if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error("--limit takes a positive whole number");

const { url, preview } = await loadEnvironment({ preview: values.preview, envDir: values["env-dir"]! });

// Imported after the environment loads: the env schema and the S3 client read it
const postgres = (await import("postgres")).default;
const { drizzle } = await import("drizzle-orm/postgres-js");
const { assertReadOnly, readOnlySession } = await import("@/lib/enrichment/read-only-session");
const command = await import("@/lib/ebooks/ingest/command");
const { applyPlan, readUploadSpeed, resumeRun } = await import("@/lib/ebooks/ingest/run");
const { formatBytes, formatDuration, reconciliationLine } = await import("@/lib/ebooks/run-text");
type Db = import("@/lib/catalogue/work-store").Db;

const cacheDir = resolve(values["cache-dir"]!);
const reportDir = resolve(values["report-dir"]!);
const host = values.host ?? command.machineName();
const localDatabase = command.isLocalDatabase(url);
const target = command.currentTarget(url);
const writes = modes === 1;
const session = writes ? postgres(url, { max: 8, onnotice: () => {} }) : readOnlySession(url);
const database = drizzle(session) as unknown as Db;

const progress = (label: string) => (done: number, total: number) => {
  if (process.stderr.isTTY) process.stderr.write(`\r${label} ${done}/${total}`);
  if (done === total && process.stderr.isTTY) process.stderr.write("\n");
};

try {
  if (preview) console.log(`Preview on port ${values.preview}: its database and S3 folder.`);
  if (values.undo) {
    const undone = await command.undoCommand({ database, undoFile: resolve(values.undo), backup: values.backup, live: values.live, localDatabase });
    console.log(`Undid run ${undone.runId}: ${undone.ebooksRemoved} eBooks and ${undone.filesRemoved} files removed; ${undone.kept} kept (changed since). S3 objects stay.`);
  } else if (values.apply || values.resume) {
    // Ctrl-C stops taking new groups; the run becomes interrupted and resumes later
    const controller = new AbortController();
    process.once("SIGINT", () => {
      console.error("\nStopping after the groups in flight; resume with --resume.");
      controller.abort();
    });
    const options = { database, host, cacheDir, target, backup: values.backup, live: values.live, localDatabase, reportDir, signal: controller.signal, onProgress: progress("Stored and registered") };
    const result = values.apply ? await applyPlan(resolve(values.apply), options) : await resumeRun(values.resume!, options);
    console.log(`Run ${result.runId}: ${result.state}. ${Object.entries(result.counts).map(([k, v]) => `${k} ${v}`).join(", ") || "nothing to do"}.`);
    console.log(`Uploaded ${formatBytes(result.uploadedBytes)} in ${formatDuration(result.seconds)}. Undo file: ${result.undoFile}`);
    if (result.state === "interrupted") console.log(`Resume with: pnpm ebooks:ingest --resume ${result.runId} --backup <dump>`);
    if (result.reconciliation) console.log(`${reconciliationLine(result.reconciliation)}${result.exact ? ": exact." : ": not exact; /ebooks/runs lists the exceptions."}`);
    process.exitCode = result.state === "finished" ? 0 : 1;
  } else {
    await assertReadOnly(session);
    const roots = command.resolveRoots(positionals);
    const { plan, files, notSetUp } = await command.planCommand({
      database,
      roots,
      host,
      cacheDir,
      target,
      reportDir,
      limit,
      includeText: values["include-text"],
      exclude: values.exclude,
      uploadSpeed: readUploadSpeed(cacheDir),
      onProgress: progress("Read"),
    });
    if (notSetUp) console.log(notSetUp);
    console.log(command.planLine(plan));
    console.log(`To upload: ${formatBytes(plan.summary.uploadBytes)} in ${plan.summary.uploadObjects} objects.`);
    console.log("Read-only: nothing was written to the database or the bucket.");
    console.log(`Report: ${files.markdown}\n        ${files.csv}\nPlan:   ${files.plan}`);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await session.end();
}
