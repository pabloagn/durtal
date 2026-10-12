/** Protected read-only matching/report by default. --sample/--score consume
 * the frozen not-yet-registered groups in --ingest-plan, before registration.
 * Apply/undo require a recent backup and --live for a nonlocal database. */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { loadEnvironment } from "./environment";

const { values } = parseArgs({
  options: {
    apply: { type: "string" },
    undo: { type: "string" },
    sample: { type: "boolean" },
    score: { type: "string" },
    from: { type: "string" },
    "ingest-plan": { type: "string" },
    only: { type: "string", multiple: true },
    rematch: { type: "boolean" },
    restore: { type: "string", multiple: true },
    "classification-only": { type: "boolean" },
    backup: { type: "string" },
    live: { type: "boolean", default: false },
    preview: { type: "string" },
    "aws-profile": { type: "string" },
    "env-dir": { type: "string", default: process.cwd() },
    "report-dir": { type: "string", default: "reports/ebooks" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "pnpm ebooks:match [--only UUID] [--sample] [--ingest-plan PLAN]\n  --score HUMAN_LABELS.csv --from PLAN\n  --apply SCORED_PLAN --backup DUMP [--live]\n  --undo MATCHING_UNDO --backup DUMP [--live]\n  --classification-only [--restore UUID] [--rematch]\n  [--preview PORT | --aws-profile durtal-personal] [--env-dir DIR] [--report-dir DIR]",
  );
  process.exit(0);
}
if ([values.apply, values.undo, values.score].filter(Boolean).length > 1)
  throw new Error("Choose one of --apply, --undo and --score");
if (values.restore?.length && !values["classification-only"])
  throw new Error("--restore requires --classification-only");
if (values.rematch && !values["classification-only"])
  throw new Error("--rematch requires --classification-only");
if (values.from && values["ingest-plan"])
  throw new Error("Give one frozen source plan");
if (values.score && !values.from && !values["ingest-plan"])
  throw new Error("--score needs --from PLAN or --ingest-plan PLAN");
const { url } = await loadEnvironment({
  preview: values.preview,
  envDir: values["env-dir"]!,
  awsProfile: values["aws-profile"],
});
const command = await import("@/lib/ebooks/match/command");
const { planMatching } = await import("@/lib/ebooks/match/plan");
const postgres = (await import("postgres")).default;
const { drizzle } = await import("drizzle-orm/postgres-js");
type Db = import("@/lib/catalogue/work-store").Db;
const session =
  values.apply || values.undo
    ? postgres(url, { max: 1, onnotice: () => {} })
    : null;
const reportDir = resolve(values["report-dir"]!);
try {
  if (values.apply) {
    const document = command.readMatchingDocument(resolve(values.apply));
    if ("kind" in document && document.kind === "classification")
      console.log(
        await command.applyClassificationDocument(
          drizzle(session!) as unknown as Db,
          url,
          document,
          { backup: values.backup, live: values.live },
        ),
      );
    else if ("kind" in document && document.kind === "registered_matching")
      console.log(
        await command.applyMatchingDocument(
          drizzle(session!) as unknown as Db,
          url,
          document,
          { backup: values.backup, live: values.live, reportDir },
        ),
      );
    else
      throw new Error(
        "Ingestion matching needs a registration map and committed run; apply a registered matching document here",
      );
  } else if (values.undo) {
    console.log(
      await command.undoMatchingDocument(
        drizzle(session!) as unknown as Db,
        url,
        resolve(values.undo),
        { backup: values.backup, live: values.live },
      ),
    );
  } else if (values["classification-only"]) {
    const ids = values.restore?.length
      ? values.restore
      : (values.only ?? "all");
    const plan = await planMatching(url, ids, {
      mode: "classification_only",
      restoreIds: values.restore,
      rematch: values.rematch,
    });
    console.log(command.writeClassificationReports(reportDir, plan));
  } else {
    const source = values.from ?? values["ingest-plan"];
    const document = source
      ? command.readMatchingDocument(resolve(source))
      : await command.planRegisteredMatching(url, values.only ?? "all");
    if (document.kind === "classification")
      throw new Error("Sampling/scoring needs a registered or separate ingestion matching document");
    if (values.score) {
      const scored = command.labelMatchingDocument(
        document,
        command.readLabels(readFileSync(resolve(values.score), "utf8")),
      );
      const files = command.writeMatchingReports(reportDir, scored);
      console.log(files);
      console.log(command.approvalOf(scored).precision?.automatic);
    } else
      console.log(
        command.writeMatchingReports(reportDir, document, !!values.sample),
      );
    console.log(
      "Read-only: no catalogue or bucket writes. Human labels are never inferred by this command.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await session?.end();
}
