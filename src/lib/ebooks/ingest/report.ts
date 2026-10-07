import type { IngestReconciliation } from "@/lib/db/schema/ebook-ingest";
import { formatLabel } from "../formats";
import type { IngestPlan } from "./plan";
import { formatBytes, formatDuration, reconciliationLine } from "../run-text";

/*
 * The plan's and the reconciliation's reports (SLN-494): Markdown for
 * reading, CSV with one row per file. Both stay on the machine that ran the
 * command (reports/ is git-ignored): they name its paths.
 */

const n = (value: number) => value.toLocaleString("en-US");

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** A table cell: a path or a reason may hold a pipe */
const md = (text: string) => text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

const table = (rows: [string, number | string][]) => ["| | |", "|---|---|", ...rows.map(([label, value]) => `| ${md(label)} | ${typeof value === "number" ? n(value) : md(value)} |`)];

const tallyTable = (tally: Record<string, number>, empty: string) => {
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? table(entries) : [empty];
};

/** The plan's summary (Markdown) and its files (CSV) */
export function planReport(plan: IngestPlan, planFile: string): { markdown: string; csv: string } {
  const s = plan.summary;
  const formats = Object.fromEntries(Object.entries(s.filesByFormat).map(([format, count]) => [formatLabel(format), count]));
  const drm = Object.fromEntries(Object.entries(s.drm).map(([kind, count]) => [kind, count]));
  const time =
    s.estimatedSeconds !== null
      ? `about ${formatDuration(s.estimatedSeconds)} at ${formatBytes(s.uploadSpeed!)}/s, the speed of the last apply on this machine`
      : "unknown until the first apply on this machine measures the upload speed";
  const markdown = [
    `# eBook ingestion plan, ${plan.createdAt}`,
    "",
    `Host ${plan.host}; ${plan.roots.length === 1 ? "folder" : "folders"} ${plan.roots.join(", ")}${plan.limit ? `; the first ${n(plan.limit)} files only` : ""}.`,
    `Bucket ${plan.target.bucket}${plan.target.prefix ? `, prefix ${plan.target.prefix}` : ""}${plan.target.preview ? " (a preview's folder)" : ""}.`,
    "",
    "Read-only: nothing was written to the database or the bucket. Apply exactly this plan with",
    "",
    "```",
    `pnpm ebooks:ingest --apply ${planFile} --backup <pg_dump file from the last hour>`,
    "```",
    "",
    "## Summary",
    "",
    ...table([
      ["Files found", s.found],
      ["eBooks to create", s.ebooksToCreate],
      ["Formats to add", s.formatsToAdd],
      ["Changed files (the old one is replaced)", s.changed],
      ["Already stored", s.alreadyStored],
      ["Already in the bucket, adopted", s.alreadyInBucket],
      ["Duplicates (stored once)", s.duplicates],
      ["Quarantined", s.quarantined.length],
      ["Ignored", Object.values(s.ignored).reduce((a, b) => a + b, 0)],
      ["Files whose sidecar carries ratings, read dates or custom columns (counted, not imported)", s.personalData],
      ["To upload", `${formatBytes(s.uploadBytes)} in ${n(s.uploadObjects)} objects`],
      ["Estimated time", time],
      ["Estimated monthly storage cost of what is added", `US$${s.monthlyCostUsd.toFixed(2)}`],
    ]),
    "",
    "## Files by format",
    "",
    ...tallyTable(formats, "No e-book files."),
    "",
    "## DRM, by kind",
    "",
    "Stored and listed with their kind, never opened.",
    "",
    ...tallyTable(drm, "None."),
    "",
    "## Quarantined",
    "",
    "Stored with their problem, never served.",
    "",
    ...(s.quarantined.length ? ["| File | Problem |", "|---|---|", ...s.quarantined.map((q) => `| ${md(q.path)} | ${md(q.reason)} |`)] : ["None."]),
    "",
    "## Ignored, by reason",
    "",
    ...tallyTable(s.ignored, "None."),
    "",
    "Every file is in the CSV beside this report, with its outcome.",
    "",
  ].join("\n");

  const header = ["path", "outcome", "reason", "format", "size_bytes", "sha256", "drm", "title", "authors", "word_count", "page_estimate", "language", "duplicate_of", "key"];
  const lines = plan.items.map((item) => {
    const file = plan.files[item.path];
    const group = item.group !== null ? plan.groups[item.group] : null;
    return [
      item.path,
      item.outcome,
      item.reason,
      item.format,
      item.size,
      item.sha256,
      file?.drm,
      group?.ebook.title,
      group?.ebook.authors.join("; "),
      file?.text.wordCount,
      file?.text.pageEstimate,
      file?.text.language,
      item.duplicateOf,
      file?.key,
    ];
  });
  const csv = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n") + "\n";
  return { markdown, csv };
}

const EXCEPTION_ORDER = ["failed", "not-stored", "changed", "missing-object", "size-mismatch", "checksum-mismatch", "no-key", "missing-derived", "unreferenced", "quarantined", "drm", "duplicate", "ignored"];
const EXCEPTION_TITLES: Record<string, string> = {
  failed: "Failed",
  "not-stored": "On disk, not in the catalogue",
  changed: "Changed since the plan",
  "missing-object": "Rows whose object is missing",
  "size-mismatch": "Rows whose object's size differs",
  "checksum-mismatch": "Rows whose object's checksum differs",
  "no-key": "Rows with no object",
  "missing-derived": "Rows whose cover or manifest is missing",
  unreferenced: "Objects no row names",
  quarantined: "Quarantined",
  drm: "DRM",
  duplicate: "Duplicates",
  ignored: "Ignored",
};

/** The reconciliation as Markdown: the summary line, then every exception by name and reason */
export function reconcileReport(r: IngestReconciliation): string {
  const kinds = [...new Set(r.exceptions.map((e) => e.kind))].sort((a, b) => EXCEPTION_ORDER.indexOf(a) - EXCEPTION_ORDER.indexOf(b));
  const blocking = r.exceptions.filter((e) => e.blocking).length;
  return [
    `# eBook reconciliation, ${r.at}`,
    "",
    `Host ${r.host ?? "unknown"}; ${r.roots.length === 1 ? "folder" : "folders"} ${r.roots.join(", ")}.`,
    "",
    `**${reconciliationLine(r)}**`,
    "",
    r.exact
      ? "Exact: every file on disk is stored or accounted for, every row's object matches it, and every object belongs to a row."
      : `Not exact: ${n(blocking)} ${blocking === 1 ? "exception needs" : "exceptions need"} attention (the first sections below).`,
    "",
    `No longer in the inbox (stored and verified; the copy is in the bucket): ${n(r.noLongerInInbox)}.`,
    `Objects younger than a day no row names yet (in flight): ${n(r.inFlight)}.`,
    "",
    ...kinds.flatMap((kind) => {
      const rows = r.exceptions.filter((e) => e.kind === kind);
      return [`## ${EXCEPTION_TITLES[kind] ?? kind} (${n(rows.length)})`, "", "| Name | Reason |", "|---|---|", ...rows.map((e) => `| ${md(e.path)} | ${md(e.reason)} |`), ""];
    }),
  ].join("\n");
}
