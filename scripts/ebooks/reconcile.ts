/**
 * E-book reconciliation (SLN-494): the files under the folders, the
 * ebook_files rows and the bucket's objects, checked by checksum and size.
 * Read-only: the session refuses writes, and a probe proves it first. Every
 * apply ends with the same check.
 *
 *   pnpm ebooks:reconcile [<folder> ...] [--include-text] [--exclude GLOB]...
 *     [--host LABEL] [--cache-dir DIR] [--report-dir DIR] [--preview PORT] [--env-dir DIR]
 *
 * With no folder it reconciles the inbox, ~/Downloads/eBooks. Writes
 * reports/ebooks/reconcile-<time>.md (git-ignored).
 */
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadEnvironment } from "./environment";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "include-text": { type: "boolean", default: false },
    exclude: { type: "string", multiple: true },
    host: { type: "string" },
    "cache-dir": { type: "string", default: resolve(homedir(), ".cache/durtal-ebooks") },
    "report-dir": { type: "string", default: "reports/ebooks" },
    preview: { type: "string" },
    "aws-profile": { type: "string" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
const { url } = await loadEnvironment({ preview: values.preview, envDir: values["env-dir"]!, awsProfile: values["aws-profile"] });

// Imported after the environment loads: the env schema and the S3 client read it
const { withReadOnlyPlanningConnection } = await import("@/lib/enrichment/read-only-session");
const command = await import("@/lib/ebooks/ingest/command");
const { reconciliationLine } = await import("@/lib/ebooks/run-text");

try {
  const { reconciliation, file } = await withReadOnlyPlanningConnection(url, (database) => command.reconcileCommand({
    database,
    roots: command.resolveRoots(positionals),
    host: values.host ?? command.machineName(),
    cacheDir: resolve(values["cache-dir"]!),
    includeText: values["include-text"],
    exclude: values.exclude,
    reportDir: resolve(values["report-dir"]!),
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
