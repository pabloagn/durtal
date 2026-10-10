import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import type { Db } from "@/lib/catalogue/work-store";
import { loadMatchCatalogue, dataFingerprint } from "./load";
import { scoreNewGroups, requireCalibration, sampleMatches, type CalibrationReceipt } from "./calibration";
import { MATCH_MODEL } from "./model";
import { matchFingerprint } from "./keys";
import type { MatchEbook } from "./types";

/** Bind evidence used by edition/copy effects as well as bibliographic score.
 * UUIDs/timestamps change during registration; bytes and capabilities do not. */
export function groupEvidence(ebook: MatchEbook) {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    instanceId: _instanceId,
    matchState: _matchState,
    matchFingerprint: _matchFingerprint,
    exclusionReason: _exclusionReason,
    preferredFileId,
    files,
    ...metadata
  } = ebook;
  return {
    metadata,
    preferredSha256:
      files.find((file) => file.id === preferredFileId)?.sha256 ?? null,
    files: files
      .map(({ id: _fileId, ...file }) => file)
      .sort(
        (a, b) =>
          a.sha256.localeCompare(b.sha256) || a.format.localeCompare(b.format),
      ),
  };
}

export interface PlannedMatchGroup {
  groupKey: string;
  sourceGroupKeys?: readonly string[];
  /** matchFingerprint of normalized metadata and planned file checksums. */
  metadataFingerprint: string;
  existingEbookId: string | null;
  ebook: Omit<MatchEbook, "id">;
}
export interface RegisteredMatchGroup {
  groupKey: string;
  ebookId: string;
  /** Every planned checksum, including existing files, maps to its real row. */
  fileIds: Readonly<Record<string, string>>;
}
/** Injected helper for callers already inside the reviewed planning callback.
 * Group keys are source identities, never claimed to be registered UUIDs. */
export async function planGroupMatching(
  conn: Db,
  groups: readonly PlannedMatchGroup[],
  inputPlanSha256: string,
) {
  const loaded = await loadMatchCatalogue(conn);
  if (
    new Set(groups.map((group) => group.groupKey)).size !== groups.length ||
    groups.some((group) => !group.groupKey)
  )
    throw new Error("Scoring groups need distinct stable keys");
  const ebooks = groups.map((group): MatchEbook => {
    const existing = group.existingEbookId
      ? loaded.catalogue.source.ebooks.find(
          (ebook) => ebook.id === group.existingEbookId,
        )
      : null;
    if (group.existingEbookId && !existing)
      throw new Error("The existing group ebook no longer exists");
    const ebook = {
      ...group.ebook,
      id: group.existingEbookId ?? `group:${group.groupKey}`,
      ...(existing
        ? {
            instanceId: existing.instanceId,
            matchState: existing.matchState,
            matchFingerprint: existing.matchFingerprint,
            exclusionReason: existing.exclusionReason,
          }
        : {}),
    };
    if (matchFingerprint(ebook) !== group.metadataFingerprint)
      throw new Error(`Changed matching metadata for group ${group.groupKey}`);
    if (
      !group.existingEbookId &&
      (ebook.instanceId ||
        ebook.matchState !== "pending" ||
        ebook.exclusionReason)
    )
      throw new Error("Unregistered groups cannot fabricate owner decisions");
    return ebook;
  });
  const scoring = scoreNewGroups(loaded, ebooks, inputPlanSha256);
  const resultById = new Map(
    scoring.results.map((result) => [result.ebookId, result]),
  );
  const groupResults = groups.map((group, i) => ({
    groupKey: group.groupKey,
    sourceGroupKeys: group.sourceGroupKeys ?? [group.groupKey],
    metadataFingerprint: group.metadataFingerprint,
    existingEbookId: group.existingEbookId,
    title: ebooks[i].title,
    authors: ebooks[i].authors,
    language: ebooks[i].language,
    candidateDescriptions: resultById
      .get(ebooks[i].id)!
      .candidates.map((candidate) => ({
        workId: candidate.workId,
        title: loaded.catalogue.byWorkId.get(candidate.workId)!.source.title,
        authors: loaded.catalogue.byWorkId
          .get(candidate.workId)!
          .source.authors.map((author) => author.name),
        editionId: candidate.effect.editionId,
        editionTitle:
          loaded.catalogue.byWorkId
            .get(candidate.workId)!
            .source.editions.find(
              (edition) => edition.id === candidate.effect.editionId,
            )?.title ??
          candidate.effect.newEdition?.title ??
          null,
      })),
    evidenceFingerprint: dataFingerprint(groupEvidence(ebooks[i])),
    decision: {
      instanceId: ebooks[i].instanceId,
      matchState: ebooks[i].matchState,
      matchFingerprint: ebooks[i].matchFingerprint,
      exclusionReason: ebooks[i].exclusionReason ?? null,
    },
    fileHashes: ebooks[i].files
      .map((file) => ({ sha256: file.sha256, format: file.format }))
      .sort((a, b) => a.sha256.localeCompare(b.sha256)),
    result: resultById.get(ebooks[i].id)!,
  }));
  return {
    version: 1 as const,
    ...scoring,
    groups: groupResults,
    groupFingerprint: dataFingerprint(groupResults),
  };
}
export async function planUnregisteredGroups(
  url: string,
  groups: readonly PlannedMatchGroup[],
  inputPlanSha256: string,
) {
  return withReadOnlyPlanningConnection(
    url,
    (conn) => planGroupMatching(conn, groups, inputPlanSha256),
    { isolationLevel: "repeatable read" },
  );
}
export type GroupMatchingPlan = Awaited<ReturnType<typeof planGroupMatching>>;
export interface ApprovedGroupMatching {
  plan: GroupMatchingPlan;
  precision: CalibrationReceipt | null;
}

/** Shared by registration preflight, group apply and the automatic link
 * writer: calibration cannot be detached from the exact candidate effects. */
export function requireApprovedGroupPlan(approval: ApprovedGroupMatching) {
  const approved = approval.plan;
  if (
    approved.version !== 1 ||
    approved.binding.modelVersion !== MATCH_MODEL.version ||
    approved.binding.modelFingerprint !== dataFingerprint(MATCH_MODEL) ||
    !/^[a-f0-9]{64}$/.test(approved.binding.inputPlanSha256) ||
    !/^[a-f0-9]{64}$/.test(approved.binding.externalInputFingerprint) ||
    new Set(approved.groups.map((group) => group.groupKey)).size !== approved.groups.length ||
    new Set(approved.results.map((result) => result.ebookId)).size !== approved.results.length ||
    approved.groups.some((group) => !group.groupKey || (!group.existingEbookId && !group.fileHashes.length) ||
      new Set(group.fileHashes.map((file) => file.sha256)).size !== group.fileHashes.length) ||
    approved.groupFingerprint !== dataFingerprint(approved.groups) ||
    approved.binding.candidateFingerprint !== dataFingerprint(approved.results) ||
    approved.binding.inputFingerprint !== dataFingerprint(
      approved.groups.map((group) => group.metadataFingerprint).sort(),
    ) ||
    dataFingerprint(approved.groups.map((group) => group.result)
      .sort((a, b) => a.ebookId.localeCompare(b.ebookId))) !== dataFingerprint(approved.results) ||
    dataFingerprint(approved.sample) !== dataFingerprint(
      sampleMatches(approved.results, dataFingerprint(approved.binding)),
    )
  )
    throw new Error("Approved matching model, scope, sample or candidate plan changed");
  if (approved.results.some((result) => result.autoLink)) {
    if (!approval.precision)
      throw new Error("Automatic links require labelled precision before registration");
    requireCalibration(approval.precision, approved.binding, approved.sample);
  }
}
