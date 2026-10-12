import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/catalogue/work-store";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { recentBackup } from "@/lib/enrichment/backup";
import {
  appendUndoLog,
  reserveUndoLog,
  readUndoLog,
} from "@/lib/books/undo-file";
import { parseCsv } from "@/lib/reading/import/csv";
import { toCSV } from "@/lib/utils/export";
import { databaseFingerprint, isLocalDatabase } from "../ingest/command";
import {
  requireIngestionMatchingScope,
  type IngestionMatchingDocument,
} from "./ingest-adapter";
import { loadMatchCatalogue, dataFingerprint } from "./load";
import {
  planGroupMatching,
  type ApprovedGroupMatching,
  type RegisteredMatchGroup,
} from "./groups";
import { scoreCalibration, type LabelledMatch } from "./calibration";
import { hashMatchingPlan, type ClassificationPlan } from "./plan";
import {
  applyApprovedGroups,
  planApprovedGroups,
  requireApprovedGroupPlan,
} from "./apply-groups";
import { planUndoLink, undoLink } from "./undo";
import type { LinkReceipt } from "./link";
import { matchFingerprint } from "./keys";
import { persistClassification } from "./classification";

export interface RegisteredMatchingDocument {
  version: 1;
  kind: "registered_matching";
  mode: "ingestion";
  runId: string;
  targetDatabase: string;
  createdAt: string;
  planSha256: string;
  approval: ApprovedGroupMatching;
  registered: readonly RegisteredMatchGroup[];
}
export async function planRegisteredMatchingOn(
  conn: Db,
  target: string,
  ids: readonly string[] | "all" = "all",
): Promise<RegisteredMatchingDocument> {
  const loaded = await loadMatchCatalogue(conn);
  const selected = loaded.catalogue.source.ebooks.filter(
    (ebook) => ids === "all" || ids.includes(ebook.id),
  );
  if (
    ids !== "all" &&
    (new Set(ids).size !== ids.length || selected.length !== ids.length)
  )
    throw new Error("A selected ebook is missing or repeated");
  const runId = randomUUID(),
    createdAt = new Date().toISOString();
  const scopeHash = dataFingerprint({
    kind: "registered_matching",
    target,
    runId,
    createdAt,
    ids: selected.map((ebook) => [ebook.id, matchFingerprint(ebook)]),
  });
  const groups = selected.map((ebook) => ({
    groupKey: `ebook:${ebook.id}`,
    existingEbookId: ebook.id,
    metadataFingerprint: matchFingerprint(ebook),
    ebook,
  }));
  const approval = {
    plan: await planGroupMatching(conn, groups, scopeHash),
    precision: null,
  };
  const document: RegisteredMatchingDocument = {
    version: 1,
    kind: "registered_matching",
    mode: "ingestion",
    runId,
    targetDatabase: target,
    createdAt,
    planSha256: "",
    approval,
    registered: selected.map((ebook) => ({
      groupKey: `ebook:${ebook.id}`,
      ebookId: ebook.id,
      fileIds: Object.fromEntries(
        ebook.files.map((file) => [file.sha256, file.id]),
      ),
    })),
  };
  document.planSha256 = hashMatchingPlan(document);
  return document;
}
export async function planRegisteredMatching(
  url: string,
  ids: readonly string[] | "all" = "all",
) {
  return withReadOnlyPlanningConnection(
    url,
    (conn) => planRegisteredMatchingOn(conn, databaseFingerprint(url), ids),
    { isolationLevel: "repeatable read" },
  );
}
export function readLabels(text: string): LabelledMatch[] {
  const [header, ...rows] = parseCsv(text);
  const columns = ["ebookId", "fingerprint", "tier", "label"];
  if (
    !header ||
    columns.some((column) => header.indexOf(column) < 0) ||
    new Set(header).size !== header.length
  )
    throw new Error(
      "Labels CSV needs distinct ebookId, fingerprint, tier and label columns",
    );
  return rows.map((row) => {
    if (row.length !== header.length)
      throw new Error("A label row has the wrong number of columns");
    const values = Object.fromEntries(
      columns.map((column) => [column, row[header.indexOf(column)]]),
    );
    if (!["right", "wrong_edition", "wrong_work"].includes(values.label))
      throw new Error(
        "Every sample row needs a human label: right, wrong_edition or wrong_work; unknown cases stay pending",
      );
    return values as unknown as LabelledMatch;
  });
}
export function approvalOf(
  document: RegisteredMatchingDocument | IngestionMatchingDocument,
): ApprovedGroupMatching {
  if (document.kind === "ingestion_matching") requireIngestionMatchingScope(document);
  else if (document.kind !== "registered_matching")
    throw new Error("Expected a registered or separate ingestion matching document");
  if (!document.approval)
    throw new Error("This document has no reviewed matching groups");
  return document.approval;
}
export function labelMatchingDocument<
  T extends RegisteredMatchingDocument | IngestionMatchingDocument,
>(document: T, labels: readonly LabelledMatch[]): T {
  const copy = structuredClone(document),
    approval = approvalOf(copy);
  approval.precision = scoreCalibration(
    approval.plan.binding,
    approval.plan.sample,
    labels,
  );
  if (copy.kind === "registered_matching") copy.planSha256 = hashMatchingPlan(copy);
  else requireIngestionMatchingScope(copy);
  requireApprovedGroupPlan(approval);
  return copy;
}
export function matchingReport(approval: ApprovedGroupMatching): string {
  const p = approval.plan,
    counts = new Map<string, number>();
  for (const result of p.results) {
    const tier = result.skipped ?? result.tier ?? "pending";
    counts.set(tier, (counts.get(tier) ?? 0) + 1);
  }
  const automatic = p.results.filter((result) => result.autoLink).length;
  const lines = [
    "# Ebook matching plan",
    "",
    `Model ${p.binding.modelVersion} · ${p.results.length} groups · ${automatic} automatic proposals.`,
    "",
    ...[...counts].map(([tier, n]) => `- ${tier}: ${n}`),
    "",
    `Catalogue: ${p.binding.catalogueFingerprint}`,
    `Input: ${p.binding.inputFingerprint}`,
    `External scoring inputs: ${p.binding.externalInputFingerprint}`,
    `Input plan: ${p.binding.inputPlanSha256}`,
    `Candidates: ${p.binding.candidateFingerprint}`,
    "",
  ];
  if (approval.precision) {
    const a = approval.precision.automatic;
    lines.push(
      `Labelled automatic precision: ${a.right}/${a.n} (${(a.precision * 100).toFixed(2)}%); wrong work: ${a.wrongWork}; Wilson 95% interval ${(a.lower95 * 100).toFixed(2)}–${(a.upper95 * 100).toFixed(2)}%.`,
      "",
    );
  } else
    lines.push(
      "Automatic links await human-labelled precision for this exact scope.",
      "",
    );
  for (const group of p.groups) {
    lines.push(
      `## ${group.title.replace(/[\r\n]/g, " ")}`,
      "",
      `${group.authors.join("; ")} · ${group.language ?? "language unknown"}.`,
      `Group: ${group.groupKey.replace(/[\r\n]/g, " ")}.`,
      `Tier: ${group.result.tier ?? group.result.skipped ?? "pending"}.`,
    );
    for (const candidate of group.result.candidates) {
      const description = group.candidateDescriptions.find(
        (row) => row.workId === candidate.workId,
      );
      lines.push(
        `- ${description?.title ?? candidate.workId} (${description?.authors.join("; ") ?? ""}, ${candidate.workId}): ${candidate.effect.text}; probability ${candidate.probability.toFixed(6)}, weight ${candidate.weightBits.toFixed(3)} bits, margin ${candidate.marginBits === null ? "n/a" : candidate.marginBits.toFixed(3)} bits.`,
      );
    }
    lines.push("");
  }
  lines.push(
    "Read-only report. No catalogue row, link, copy or object was written.",
  );
  return lines.join("\n");
}
export function matchingCsv(
  approval: ApprovedGroupMatching,
  sampleOnly = false,
): string {
  const rows = (sampleOnly ? approval.plan.sample : approval.plan.results).map(
    (result) => {
      const group = approval.plan.groups.find(
        (group) => group.result.ebookId === result.ebookId,
      )!;
      return {
        ebookId: result.ebookId,
        fingerprint: result.fingerprint,
        tier: result.tier ?? result.skipped ?? "",
        title: group.title,
        authors: group.authors.join("; "),
        language: group.language ?? "",
        proposedWorkId: result.candidates[0]?.workId ?? "",
        proposedWorkTitle: group.candidateDescriptions[0]?.title ?? "",
        proposedWorkAuthors:
          group.candidateDescriptions[0]?.authors.join("; ") ?? "",
        proposedEditionId: result.candidates[0]?.effect.editionId ?? "",
        proposedEditionTitle:
          group.candidateDescriptions[0]?.editionTitle ?? "",
        editionRule: result.candidates[0]?.effect.rule ?? "",
        effect: result.candidates[0]?.effect.text ?? "",
        label: "",
      };
    },
  );
  return toCSV(rows, [
    "ebookId",
    "fingerprint",
    "tier",
    "title",
    "authors",
    "language",
    "proposedWorkId",
    "proposedWorkTitle",
    "proposedWorkAuthors",
    "proposedEditionId",
    "proposedEditionTitle",
    "editionRule",
    "effect",
    "label",
  ]);
}
export function writeMatchingReports(
  dir: string,
  document: RegisteredMatchingDocument | IngestionMatchingDocument,
  sampleOnly = false,
) {
  const approval = approvalOf(document),
    stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (document.kind === "ingestion_matching")
    requireReportOutsideRoots(dir, document.ingestPlan.roots);
  mkdirSync(dir, { recursive: true });
  const prefix = path.join(dir, `matching-${stamp}`),
    files = {
      markdown: `${prefix}.md`,
      csv: `${prefix}${sampleOnly ? ".sample" : ""}.csv`,
      plan: `${prefix}.plan.json`,
    };
  writeFileSync(files.markdown, matchingReport(approval), { flag: "wx" });
  writeFileSync(files.csv, matchingCsv(approval, sampleOnly), { flag: "wx" });
  writeFileSync(files.plan, JSON.stringify(document, null, 2), { flag: "wx" });
  return files;
}
export function checkMatchingWrite(
  url: string,
  options: { backup?: string; live?: boolean; now?: number },
) {
  if (!recentBackup(options.backup, options.now))
    throw new Error(
      "Matching apply/undo needs a pg_dump custom backup from the last hour. Nothing written.",
    );
  if (!isLocalDatabase(url) && !options.live)
    throw new Error(
      "Matching apply/undo to this database requires --live. Nothing written.",
    );
}
function checkMatchingPlanAge(createdAt: string, now = Date.now()) {
  const created = Date.parse(createdAt);
  if (
    !Number.isFinite(created) ||
    created > now + 300_000 ||
    now - created > 7 * 86_400_000
  )
    throw new Error("Matching plan is invalid or older than seven days. Nothing written.");
}
export async function applyMatchingDocument(
  conn: Db,
  url: string,
  document: RegisteredMatchingDocument,
  options: { backup?: string; live?: boolean; reportDir: string },
) {
  checkMatchingWrite(url, options);
  if (
    document.version !== 1 ||
    document.kind !== "registered_matching" ||
    document.mode !== "ingestion" ||
    document.targetDatabase !== databaseFingerprint(url) ||
    document.planSha256 !== hashMatchingPlan(document)
  )
    throw new Error(
      "Matching document identity, target, mode or hash changed. Nothing written.",
    );
  checkMatchingPlanAge(document.createdAt);
  const planned = await planApprovedGroups(
    url,
    document.approval,
    document.registered,
    document.runId,
  );
  if (planned.kind === "unchanged") return planned;
  mkdirSync(options.reportDir, { recursive: true });
  const undoFile = path.join(
    options.reportDir,
    `matching-undo-${document.runId}-${randomUUID()}.jsonl`,
  );
  reserveUndoLog(undoFile, {
    kind: "matching",
    runId: document.runId,
    planSha256: document.planSha256,
    approvedGroupHash: dataFingerprint(document.approval.plan),
    targetDatabase: document.targetDatabase,
    createdAt: new Date().toISOString(),
  });
  const result = await applyApprovedGroups(
    conn,
    planned.plan,
    document.targetDatabase,
    {
      beforeWrite: async (entry) => {
        appendUndoLog(undoFile, entry);
      },
    },
  );
  return {
    kind: "applied" as const,
    runId: document.runId,
    undoFile,
    linked: result.linked,
    classified: result.classified,
  };
}
export async function undoMatchingDocument(
  conn: Db,
  url: string,
  file: string,
  options: { backup?: string; live?: boolean },
) {
  checkMatchingWrite(url, options);
  const { header, entries } = readUndoLog<
    {
      kind: string;
      runId: string;
      planSha256: string;
      approvedGroupHash: string;
      targetDatabase: string;
    },
    LinkReceipt
  >(file);
  if (
    header.kind !== "matching" ||
    header.targetDatabase !== databaseFingerprint(url) ||
    !/^[a-f0-9]{64}$/.test(header.planSha256) ||
    entries.some(
      (entry) =>
        entry.runId !== header.runId ||
        entry.targetDatabase !== header.targetDatabase ||
        entry.approvedGroupHash !== header.approvedGroupHash,
    )
  )
    throw new Error(
      "Matching undo header or operation scope differs. Nothing written.",
    );
  let undone = 0,
    preserved = 0;
  for (const entry of [...entries].reverse()) {
    const planned = await planUndoLink(url, entry);
    if (planned.kind === "planned") {
      await undoLink(conn, planned.plan, header.targetDatabase);
      undone++;
    } else preserved++;
  }
  return { undone, preserved };
}
export function readMatchingDocument(file: string) {
  const document = JSON.parse(readFileSync(file, "utf8")) as
    | RegisteredMatchingDocument
    | IngestionMatchingDocument
    | ClassificationPlan;
  // Classification documents retain their existing guarded apply path. A bare
  // ingest plan cannot stand in for a separate, input-bound matching approval.
  if (document.kind !== "classification") approvalOf(document);
  return document;
}
export function requireReportOutsideRoots(
  dir: string,
  roots: readonly string[],
) {
  let ancestor = path.resolve(dir);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    const next = path.dirname(ancestor);
    if (next === ancestor) throw new Error("No report ancestor exists");
    ancestor = next;
  }
  const destination = path.resolve(realpathSync(ancestor), ...suffix);
  for (const root of roots) {
    const base = existsSync(root) ? realpathSync(root) : path.resolve(root),
      relative = path.relative(base, destination);
    if (
      !relative ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    )
      throw new Error("Matching reports cannot be written inside source roots");
  }
}
export async function applyClassificationDocument(
  conn: Db,
  url: string,
  document: ClassificationPlan,
  options: { backup?: string; live?: boolean },
) {
  checkMatchingWrite(url, options);
  if (document.mode !== "classification_only")
    throw new Error("This path requires classification-only mode");
  checkMatchingPlanAge(document.createdAt);
  await persistClassification(conn, document, databaseFingerprint(url));
  return {
    classified: document.results.filter((result) => !result.skipped).length,
  };
}
export function writeClassificationReports(
  dir: string,
  plan: ClassificationPlan,
) {
  mkdirSync(dir, { recursive: true });
  const prefix = path.join(
    dir,
    `classification-${plan.createdAt.replace(/[:.]/g, "-")}`,
  );
  const files = {
    markdown: `${prefix}.md`,
    csv: `${prefix}.csv`,
    plan: `${prefix}.plan.json`,
  };
  writeFileSync(
    files.markdown,
    `# Ebook classification\n\nMode: ${plan.mode}. ${plan.results.length} ebooks.\n\nThis plan only updates review tiers and candidates. Restored decisions return to pending.\n\nRead-only: no catalogue or object write occurred.\n`,
    { flag: "wx" },
  );
  writeFileSync(
    files.csv,
    toCSV(
      plan.results.map((result) => ({
        ebookId: result.ebookId,
        fingerprint: result.fingerprint,
        tier: result.tier ?? result.skipped ?? "",
        effect: result.candidates[0]?.effect.text ?? "",
      })),
    ),
    { flag: "wx" },
  );
  writeFileSync(files.plan, JSON.stringify(plan, null, 2), { flag: "wx" });
  return files;
}
