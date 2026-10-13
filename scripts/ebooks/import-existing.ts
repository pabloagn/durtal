/**
 * Import existing (SLN-657): give Durtal's own books their e-books from the
 * Calibre library, and nothing else. Never a new work, author, series or
 * publisher; every other Calibre book is left for Bulk import.
 *
 *   pnpm ebooks:import-existing --calibre SNAPSHOT [<library folder>]
 *   pnpm ebooks:import-existing --match SELECTION
 *     [--cache-dir DIR] [--report-dir DIR] [--preview PORT | --aws-profile PROFILE] [--env-dir DIR]
 *
 * - The dry run (`--calibre`): scores every Calibre book of the snapshot
 *   against Durtal's books through the read-only planning session, checks
 *   the formats of the books in scope on the drive (read only), and writes
 *   reports/ebooks/import-existing-<time>.md, .csv and .selection.json.
 *   Nothing is written to Durtal, the bucket or the drive. The folder
 *   defaults to where the snapshot was taken.
 * - Then `pnpm ebooks:ingest --calibre SNAPSHOT --select SELECTION` plans
 *   the selected books alone, and its apply stores them.
 * - `--match SELECTION`: once the ingest is applied, plans the matching of
 *   the e-books the selection became, one book one e-book, and writes the
 *   matching report, its sample to label and its plan. Score the labels and
 *   apply with `pnpm ebooks:match --score LABELS --from PLAN` and
 *   `--apply SCORED --backup DUMP`.
 */
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadEnvironment } from "./environment";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    calibre: { type: "string" },
    match: { type: "string" },
    "cache-dir": { type: "string", default: resolve(homedir(), ".cache/durtal-ebooks") },
    "report-dir": { type: "string", default: "reports/ebooks" },
    preview: { type: "string" },
    "aws-profile": { type: "string" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});

try {
  if (!values.calibre === !values.match) throw new Error("Give --calibre SNAPSHOT for the dry run, or --match SELECTION after the ingest");
  if (positionals.length > (values.calibre ? 1 : 0)) throw new Error("Only the dry run takes a folder: the library's, when it is mounted elsewhere than at the snapshot");
  const { url } = await loadEnvironment({ preview: values.preview, envDir: values["env-dir"]!, awsProfile: values["aws-profile"] });

  // Imported after the environment loads: the env schema reads it
  const { withReadOnlyPlanningConnection } = await import("@/lib/enrichment/read-only-session");
  const { databaseFingerprint } = await import("@/lib/ebooks/ingest/command");
  const { readUploadSpeed } = await import("@/lib/ebooks/ingest/run");
  const { readSelection } = await import("@/lib/ebooks/calibre/selection");
  const existing = await import("@/lib/ebooks/calibre/import-existing");
  const reportDir = resolve(values["report-dir"]!);

  if (values.match) {
    const selection = readSelection(resolve(values.match));
    const { document, notStored } = await withReadOnlyPlanningConnection(
      url,
      (database) => existing.planSelectionMatchingOn(database, databaseFingerprint(url), selection),
      { isolationLevel: "repeatable read" },
    );
    const { writeMatchingReports } = await import("@/lib/ebooks/match/command");
    const files = writeMatchingReports(reportDir, document, true);
    const results = document.approval.plan.results;
    console.log(
      `${results.length} e-books scored: ${results.filter((r) => r.autoLink).length} would link by themselves, ` +
        `${results.filter((r) => !r.autoLink).length} go to review.${notStored ? ` ${notStored} selected books are not e-books in Durtal yet.` : ""}`,
    );
    console.log("Read-only: nothing was written. Label the sample, then pnpm ebooks:match --score LABELS --from PLAN.");
    console.log(`Report: ${files.markdown}\nSample: ${files.csv}\nPlan:   ${files.plan}`);
  } else {
    const plan = await withReadOnlyPlanningConnection(
      url,
      (database) =>
        existing.planImportExistingOn(database, resolve(values.calibre!), {
          root: positionals[0] ? resolve(positionals[0]) : undefined,
          uploadSpeed: readUploadSpeed(resolve(values["cache-dir"]!)),
        }),
      { isolationLevel: "repeatable read" },
    );
    const files = existing.writeImportExisting(plan, reportDir);
    const c = existing.importExistingCounts(plan);
    console.log(
      `${c.books} Calibre books: ${c.selected} selected (${c.auto} link by themselves, ${c.review} to review), ` +
        `${c.alreadyStored} already in Durtal, ${c.noFile} in scope with no file on the drive. ` +
        `Durtal's books: ${plan.coverage.auto} by themselves, ${plan.coverage.review} in review, ${plan.coverage.none.length} with no e-book in Calibre.`,
    );
    console.log("Dry run: nothing was written to Durtal, the bucket or the drive.");
    console.log(`Report:    ${files.markdown}\n           ${files.csv}\nSelection: ${files.selection}`);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
