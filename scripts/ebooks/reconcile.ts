/**
 * E-book reconciliation (SLN-494): the files under the folders, the
 * ebook_files rows and the bucket's objects, checked by checksum and size.
 * Read-only: the session refuses writes, and a probe proves it first. Every
 * apply ends with the same check.
 *
 *   pnpm ebooks:reconcile [<folder> ...] [--include-text] [--exclude GLOB]...
 *     [--host LABEL] [--cache-dir DIR] [--report-dir DIR] [--preview PORT] [--env-dir DIR]
 *   pnpm ebooks:reconcile --run RUN_ID [--cache-dir DIR] [--report-dir DIR] [--preview PORT] [--env-dir DIR]
 *
 * With no folder it reconciles the inbox, ~/Downloads/eBooks. `--run` checks
 * again what an apply checked when it ended, from the plan the run kept: the
 * way to reconcile an e-book library run, which took only some of the library's files.
 * Writes reports/ebooks/reconcile-<time>.md (git-ignored).
 */
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadEnvironment } from "./environment";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "include-text": { type: "boolean", default: false },
    exclude: { type: "string", multiple: true },
    host: { type: "string" },
    run: { type: "string" },
    "cache-dir": { type: "string", default: resolve(homedir(), ".cache/durtal-ebooks") },
    "report-dir": { type: "string", default: "reports/ebooks" },
    preview: { type: "string" },
    "aws-profile": { type: "string" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
if (values.run && positionals.length) {
  console.error("Name folders or --run, not both.");
  process.exit(1);
}
const { url } = await loadEnvironment({ preview: values.preview, envDir: values["env-dir"]!, awsProfile: values["aws-profile"] });

// Imported after the environment loads: the env schema and the S3 client read it
const { withReadOnlyPlanningConnection } = await import("@/lib/enrichment/read-only-session");
const command = await import("@/lib/ebooks/ingest/command");
const { reconciliationLine } = await import("@/lib/ebooks/run-text");
const { runReconcileScope } = await import("@/lib/ebooks/ingest/run");

/** The folders named, else the inbox; with no inbox, how to reconcile a library run */
function inboxOrFolders(named: string[]) {
  if (!named.length && !existsSync(command.inboxPath()))
    throw new Error(`${command.INBOX_LABEL} does not exist. Name a folder, or reconcile a run with --run RUN_ID (an apply prints its id).`);
  return command.resolveRoots(named);
}

try {
  const cacheDir = resolve(values["cache-dir"]!);
  const { reconciliation, file } = await withReadOnlyPlanningConnection(url, async (database) => command.reconcileCommand({
    database,
    cacheDir,
    reportDir: resolve(values["report-dir"]!),
    ...(values.run
      ? await runReconcileScope(database, values.run, cacheDir)
      : {
          roots: inboxOrFolders(positionals),
          host: values.host ?? command.machineName(),
          includeText: values["include-text"],
          exclude: values.exclude,
        }),
  }));
  const blocking = reconciliation.exceptions.filter((e) => e.blocking).length;
  console.log(`${reconciliationLine(reconciliation)}: ${reconciliation.exact ? "exact" : `not exact, ${blocking} to look at`}.`);
  console.log(`No longer in the inbox: ${reconciliation.noLongerInInbox}. In flight: ${reconciliation.inFlight}.`);
  console.log(`Report: ${file}`);
  process.exitCode = reconciliation.exact ? 0 : 1;
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
