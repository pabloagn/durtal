import type { Db } from "@/lib/catalogue/work-store";
import type { IngestPlan } from "../ingest/plan";
import { readGroupCatalogue, planRegistration } from "../ingest/register";
import { clusterGroups } from "../ingest/group-clusters";
import {
  loadMatchCatalogue,
  matchFileFromStoredRow,
  dataFingerprint,
} from "./load";
import {
  planGroupMatching,
  type PlannedMatchGroup,
  type RegisteredMatchGroup,
} from "./groups";
import { matchFingerprint } from "./keys";
import type { MatchEbook } from "./types";
import { planApprovedGroupsOn } from "./apply-groups";

/** The matching input hash excludes only the matching result/labels, avoiding
 * a circular hash while binding every actual ingestion input/target field. */
export function ingestionMatchingInputHash(plan: IngestPlan) {
  const { matching: _matching, ...input } = plan;
  return dataFingerprint(input);
}
export async function planIngestionMatchingOn(conn: Db, plan: IngestPlan) {
  const loaded = await loadMatchCatalogue(conn);
  const groups: PlannedMatchGroup[] = [];
  for (const source of clusterGroups(plan.groups)) {
    const combined = {
      ...source[0],
      paths: source.flatMap((group) => group.paths),
    };
    const files = combined.paths.map((path) => plan.files[path]);
    const catalogue = await readGroupCatalogue(conn, combined, files);
    if ([...catalogue.bySha.values()].some((file) => file.ebookId !== catalogue.ebook?.id))
      throw new Error("One ingestion group names files owned by different ebooks");
    const existing = catalogue.ebook
      ? loaded.catalogue.source.ebooks.find(
          (ebook) => ebook.id === catalogue.ebook!.id,
        )
      : null;
    let plannedFiles = [...(existing?.files ?? [])];
    // Simulate the same ordered per-group registrations as apply. Combining
    // aliases into one registration would leave two same-format files active
    // and could choose a different preferred file from the real writer.
    const virtual = { ...catalogue, bySha: new Map(catalogue.bySha) };
    for (const group of source) {
      const registration = planRegistration(
        group, group.paths.map((path) => plan.files[path]), virtual,
        { host: plan.host, at: new Date(plan.createdAt) },
      );
      const replaced = new Set(registration.replaced.map((row) => row.fileId));
      plannedFiles = plannedFiles.map((file) => replaced.has(file.id)
        ? { ...file, status: "replaced", availability: "blocked" as const }
        : file);
      plannedFiles.push(...registration.inserts.map((file) => matchFileFromStoredRow({
          id: file.id,
          ebook_id: file.ebookId,
          sha256: file.sha256,
          s3_key: file.s3Key,
          format: file.format,
          size_bytes: file.sizeBytes,
          content_type: file.contentType,
          status: file.status,
          drm: file.drm,
          metadata: file.metadata,
          text_language: file.textLanguage,
          cover_key: file.coverKey,
          manifest_key: file.manifestKey,
      })));
      const own = [
        ...(virtual.ebook?.files ?? []).map((file) => replaced.has(file.id)
          ? { ...file, status: "replaced" }
          : file),
        ...registration.inserts.map((file) => ({
          id: file.id!, ebookId: registration.ebookId, sha256: file.sha256,
          format: file.format, status: file.status, drm: file.drm ?? null,
          coverKey: file.coverKey ?? null, metadata: file.metadata ?? {},
          createdAt: registration.at,
        })),
      ];
      for (const file of own) virtual.bySha.set(file.sha256, file);
      virtual.ebook = {
        id: registration.ebookId, files: own,
        preferredFileId: registration.preferredAfter,
        coverKey: registration.coverAfter, updatedAt: registration.at,
      };
    }
    const metadata = combined.ebook;
    const ebook: MatchEbook = {
      ...(existing ?? {
        id: "planned",
        title: metadata.title,
        subtitle: metadata.subtitle,
        authors: metadata.authors,
        language: metadata.language,
        isbns: metadata.isbns,
        identifiers: metadata.identifiers,
        series: metadata.series,
        seriesIndex: metadata.seriesIndex,
        publisher: metadata.publisher,
        publishedYear: metadata.publishedYear,
        createdAt: plan.createdAt,
        updatedAt: plan.createdAt,
        instanceId: null,
        matchState: "pending" as const,
        matchFingerprint: null,
        exclusionReason: null,
      }),
      files: plannedFiles,
      preferredFileId: virtual.ebook!.preferredFileId,
      coverKey: virtual.ebook!.coverKey,
    };
    groups.push({
      groupKey: source[0].key,
      sourceGroupKeys: source.map((group) => group.key),
      existingEbookId: existing?.id ?? null,
      metadataFingerprint: matchFingerprint(ebook),
      ebook,
    });
  }
  return planGroupMatching(conn, groups, ingestionMatchingInputHash(plan));
}
/** Build the id map for a fully registered plan, including resume runs with
 * every ingestion item already marked done. Reads occur in the callback. */
export async function registeredIngestionGroupsOn(
  conn: Db,
  plan: IngestPlan,
): Promise<RegisteredMatchGroup[]> {
  if (!plan.matching)
    throw new Error("This ingestion plan has no reviewed matching groups");
  const loaded = await loadMatchCatalogue(conn);
  return plan.matching.plan.groups.map((group) => {
    const files = group.fileHashes.map((file) =>
      loaded.rows.ebook_files.find(
        (row) => row.sha256 === file.sha256 && row.format === file.format,
      ),
    );
    if (
      files.some((row) => !row) ||
      new Set(files.map((row) => row!.ebook_id)).size !== 1
    )
      throw new Error(
        `Matching group ${group.groupKey} is not completely registered`,
      );
    return {
      groupKey: group.groupKey,
      ebookId: String(files[0]?.ebook_id),
      fileIds: Object.fromEntries(
        files.map((row) => [String(row!.sha256), String(row!.id)]),
      ),
    };
  });
}

/** SLN-494/498's complete no-op preflight calls this inside its protected
 * callback, before reserving a run or undo log. Registration/publication
 * completeness remains the upstream preflight's separate responsibility. */
export async function ingestionMatchingIsCurrentOn(conn: Db, plan: IngestPlan) {
  if (!plan.matching) return false;
  if (plan.matching.plan.binding.inputPlanSha256 !== ingestionMatchingInputHash(plan))
    throw new Error("Matching scope differs from the frozen ingestion inputs");
  const registered = await registeredIngestionGroupsOn(conn, plan);
  const result = await planApprovedGroupsOn(conn, plan.matching, registered, {
    // Scope identity only: no run is allocated or returned by this preflight.
    runId: plan.matching.plan.binding.inputPlanSha256,
    targetDatabase: plan.target.database,
  });
  return result.kind === "unchanged";
}
