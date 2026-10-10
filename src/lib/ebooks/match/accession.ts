import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { planBookWork, planBookEdition } from "@/lib/catalogue/book-store";
import { uniqueSlug } from "@/lib/catalogue/slugs";
import { isbnClash } from "@/lib/catalogue/isbn-clash";
import {
  authors,
  series,
  works,
  instances,
  ebooks,
  ebookMatchCandidates,
  instanceStatusHistory,
  workStatusHistory,
  activityEvents,
} from "@/lib/db/schema";
import { atomicOn } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import {
  queueNewBookEnrichment,
  BULK_ACCESSION_PRIORITY,
} from "@/lib/enrichment/queue";
import {
  generateAuthorSlug,
  generateWorkSlug,
  slugify,
} from "@/lib/utils/slugify";
import { seriesTitleKey } from "@/lib/series/work-series";
import { databaseFingerprint } from "../ingest/command";
import {
  accessionBatchEffects,
  type AccessionChoices,
  type AccessionEffect,
} from "./effects";
import {
  loadMatchCatalogue,
  dataFingerprint,
  type LoadedMatchCatalogue,
} from "./load";
import { hashMatchingPlan } from "./plan";
import { MATCH_MODEL } from "./model";
import { snapshotGuardQueries } from "./guards";
import { commitReceiptQuery, immutableMatchingWriterInput, type LinkReceipt } from "./link";
import { matchFingerprint } from "./keys";
import type { MatchOperationIdentity } from "./types";
import { planCoverCopy, copyPlannedCover, discardUnusedCover } from "./covers";
import { requireMatchAtomicExtension, type PreparedMatchAtomicExtension } from "./review-extension";

type NewAuthor = {
  id: string;
  name: string;
  sortName: string;
  slug: string;
  activityId: string;
};
type NewSeries = { id: string; title: string; slug: string };
interface AccessionEntry {
  effect: AccessionEffect;
  metadataFingerprint: string;
  workId: string;
  workSlug: string;
  editionId: string;
  instanceId: string;
  authorIds: readonly string[];
  seriesId: string | null;
  receipt: LinkReceipt;
}
export interface AccessionPlan extends MatchOperationIdentity {
  kind: "accession_batch";
  mode: "ingestion";
  modelFingerprint: string;
  createdAt: string;
  snapshot: Pick<
    LoadedMatchCatalogue,
    "rows" | "catalogueFingerprint" | "inputFingerprint"
  >;
  authors: readonly NewAuthor[];
  series: readonly NewSeries[];
  entries: readonly AccessionEntry[];
}
/** All transitive reads, including slug and ISBN checks, use the callback's
 * connection. The returned value is a JSON DTO, never a query closure. */
export async function planAccessionOn(
  conn: Db,
  ids: readonly string[],
  identity: { runId: string; targetDatabase: string; now?: string },
  choices: ReadonlyMap<string, AccessionChoices> = new Map(),
): Promise<AccessionPlan> {
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length)
    throw new Error("Choose one to fifty distinct ebooks per atomic accession");
  const loaded = await loadMatchCatalogue(conn);
  const selected = loaded.catalogue.source.ebooks.filter((ebook) =>
    ids.includes(ebook.id),
  );
  if (selected.length !== ids.length)
    throw new Error("An accession ebook is missing");
  const effects = accessionBatchEffects(selected, loaded.catalogue, choices);
  if (effects.some((effect) => !effect.ready))
    throw new Error(
      effects
        .filter((effect) => !effect.ready)
        .map((effect) => effect.text)
        .join("; "),
    );
  const newAuthors = new Map<string, NewAuthor>(),
    newSeries = new Map<string, NewSeries>();
  const entries: AccessionEntry[] = [];
  const now = identity.now ?? new Date().toISOString();
  const plan: AccessionPlan = {
    version: 1,
    operationId: randomUUID(),
    runId: identity.runId,
    planSha256: "",
    targetDatabase: identity.targetDatabase,
    kind: "accession_batch",
    mode: "ingestion",
    modelFingerprint: dataFingerprint(MATCH_MODEL),
    createdAt: now,
    snapshot: {
      rows: loaded.rows,
      catalogueFingerprint: loaded.catalogueFingerprint,
      inputFingerprint: loaded.inputFingerprint,
    },
    authors: [],
    series: [],
    entries,
  };
  const heldIsbns = new Set<string>();
  for (const effect of effects) {
    const workId = randomUUID(),
      editionId = randomUUID(),
      instanceId = randomUUID();
    const ownedAuthors: NewAuthor[] = [];
    const authorIds: string[] = [];
    for (const author of effect.authors) {
      if (author.existingId) {
        authorIds.push(author.existingId);
        continue;
      }
      let resolved = newAuthors.get(author.createKey!);
      if (!resolved) {
        resolved = {
          id: randomUUID(),
          name: author.name,
          sortName: author.sortName,
          slug: await uniqueSlug(
            authors,
            generateAuthorSlug(author.name),
            { taken: [...newAuthors.values()].map((row) => row.slug) },
            conn,
          ),
          activityId: randomUUID(),
        };
        newAuthors.set(author.createKey!, resolved);
        ownedAuthors.push(resolved);
      }
      authorIds.push(resolved.id);
    }
    let seriesId: string | null = null,
      ownedSeries: NewSeries | null = null;
    if (effect.work!.seriesName) {
      const key = seriesTitleKey(effect.work!.seriesName);
      const existing = loaded.rows.series.filter(
        (row) => seriesTitleKey(String(row.title)) === key,
      );
      if (existing.length > 1)
        throw new Error(
          "Choose the series: several catalogue series have this name",
        );
      seriesId = existing.length
        ? String(existing[0].id)
        : (newSeries.get(key)?.id ?? null);
      if (!seriesId) {
        ownedSeries = {
          id: randomUUID(),
          title: effect.work!.seriesName.trim().replace(/\s+/g, " "),
          slug: await uniqueSlug(
            series,
            slugify(effect.work!.seriesName) || "series",
            { taken: [...newSeries.values()].map((row) => row.slug) },
            conn,
          ),
        };
        newSeries.set(key, ownedSeries);
        seriesId = ownedSeries.id;
      }
    }
    const isbn = effect.edition!.isbn13;
    if (isbn) {
      const clash = await isbnClash({ isbn13: isbn }, undefined, conn);
      if (clash || heldIsbns.has(isbn))
        throw new Error(clash ?? "Two accessions cannot claim the same ISBN");
      heldIsbns.add(isbn);
    }
    const receipt: LinkReceipt = {
      version: 1,
      operationId: randomUUID(),
      runId: identity.runId,
      planSha256: "",
      targetDatabase: identity.targetDatabase,
      kind: "accession",
      ebookId: effect.ebookId,
      workId,
      editionId,
      instanceId,
      createdEdition: true,
      createdInstance: true,
      movedFromEditionId: null,
      workCreated: true,
      authorIdsCreated: ownedAuthors.map((row) => row.id),
      seriesIdCreated: ownedSeries?.id ?? null,
      historyIdsCreated: [randomUUID(), randomUUID()],
      activityIdsCreated: [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        ...ownedAuthors.map((row) => row.activityId),
      ],
      before: {
        ebook: loaded.rows.ebooks.find((row) => row.id === effect.ebookId)!,
        instance: null,
        candidates: loaded.rows.ebook_match_candidates.filter(
          (row) => row.ebook_id === effect.ebookId,
        ),
      },
    };
    entries.push({
      effect,
      metadataFingerprint: matchFingerprint(
        selected.find((ebook) => ebook.id === effect.ebookId)!,
      ),
      workId,
      workSlug: await uniqueSlug(
        works,
        generateWorkSlug(effect.work!.title, effect.authors[0].name, workId),
        { taken: entries.map((entry) => entry.workSlug) },
        conn,
      ),
      editionId,
      instanceId,
      authorIds,
      seriesId,
      receipt,
    });
  }
  plan.authors = [...newAuthors.values()];
  plan.series = [...newSeries.values()];
  // Receipts bind the executable plan. Exclude the circular receipt hash only
  // while calculating it, then validate by the same canonical procedure.
  plan.planSha256 = accessionPlanHash(plan);
  for (const entry of entries) entry.receipt.planSha256 = plan.planSha256;
  return plan;
}
export function accessionPlanHash(plan: AccessionPlan) {
  return hashMatchingPlan({
    ...plan,
    entries: plan.entries.map((entry) => ({
      ...entry,
      receipt: { ...entry.receipt, planSha256: "" },
    })),
  });
}
export async function planAccession(
  url: string,
  ids: readonly string[],
  choices: ReadonlyMap<string, AccessionChoices> = new Map(),
) {
  return withReadOnlyPlanningConnection(
    url,
    (conn) =>
      planAccessionOn(
        conn,
        ids,
        { runId: randomUUID(), targetDatabase: databaseFingerprint(url) },
        choices,
      ),
    { isolationLevel: "repeatable read" },
  );
}
export async function accessionEbooks(
  conn: Db,
  plan: AccessionPlan,
  target: string,
  options: {
    atomicExtension?: PreparedMatchAtomicExtension;
    beforeWrite?: (receipt: LinkReceipt) => Promise<void>;
    afterCommit?: (ids: {
      workIds: readonly string[];
      editionIds: readonly string[];
    }) => Promise<void>;
  } = {},
) {
  plan = immutableMatchingWriterInput(plan);
  options = { ...options };
  if (
    plan.kind !== "accession_batch" ||
    plan.mode !== "ingestion" ||
    plan.version !== 1 ||
    plan.targetDatabase !== target ||
    plan.planSha256 !== accessionPlanHash(plan) ||
    plan.modelFingerprint !== dataFingerprint(MATCH_MODEL) ||
    !plan.entries.length ||
    plan.entries.length > 50 ||
    plan.entries.some(
      (entry) =>
        !entry.effect.ready || entry.receipt.planSha256 !== plan.planSha256,
    )
  )
    throw new Error("Accession mode, model, target, hash or effects changed");
  const extension = requireMatchAtomicExtension(options.atomicExtension, {
    coreWriter: "accession", coreOperation: plan,
    ebookIds: plan.entries.map((entry) => entry.effect.ebookId),
  });
  const at = new Date(plan.createdAt);
  if (!Number.isFinite(at.getTime()))
    throw new Error("Invalid accession timestamp");
  const timestamp = at.getTime();
  const coverPlans = plan.entries.map((entry) =>
    planCoverCopy(
      plan.snapshot,
      entry.effect.ebookId,
      entry.editionId,
      entry.effect.edition!.coverSourceKey,
    ),
  );
  const prepared = await Promise.all(
    plan.entries.map(async (original, i) => {
      const coverPlan = coverPlans[i];
      const entry = immutableMatchingWriterInput({
        ...original,
        receipt: {
          ...original.receipt,
          ...(coverPlan
            ? { coverArtifacts: [coverPlan.coverKey, coverPlan.thumbnailKey] }
            : {}),
        },
      });
      const { seriesName: _seriesName, ...workValues } = entry.effect.work!;
      const { coverSourceKey: _coverSourceKey, ...editionValues } =
        entry.effect.edition!;
      return {
        entry,
        work: await planBookWork(
          {
            ...workValues,
            seriesId: entry.seriesId,
            authorIds: entry.authorIds.map((authorId) => ({
              authorId,
              role: "author" as const,
            })),
          },
          entry.effect.authors[0].name,
          {
            id: entry.workId,
            slug: entry.workSlug,
            activityId: entry.receipt.activityIdsCreated[0],
            at,
          },
        ),
        edition: await planBookEdition(
          { workId: entry.workId, ...editionValues },
          {
            id: entry.editionId,
            activityId: entry.receipt.activityIdsCreated[1],
            at,
            cover: null,
          },
        ),
      };
    }),
  );
  for (const { entry } of prepared) await options.beforeWrite?.(entry.receipt);
  try {
    for (const [i, coverPlan] of coverPlans.entries())
      if (coverPlan) {
        const entry = prepared[i].entry;
        const { coverSourceKey: _coverSourceKey, ...values } =
          entry.effect.edition!;
        prepared[i].edition = await planBookEdition(
          { workId: entry.workId, ...values },
          {
            id: entry.editionId,
            activityId: entry.receipt.activityIdsCreated[1],
            at,
            cover: immutableMatchingWriterInput(await copyPlannedCover(coverPlan)),
          },
        );
      }
    const result = await withReadableErrors(() =>
      atomicOn(conn, (d) => {
        if (at.getTime() !== timestamp)
          throw new Error("Prepared accession timestamp changed; nothing written");
        return [
          ...snapshotGuardQueries(d, plan.snapshot, extension?.extraTables),
          ...(extension?.before(d) ?? []),
          d.execute(
            sql`select set_config('durtal.defer_publisher_refresh','on',true)`,
          ),
          ...plan.authors.flatMap(({ activityId, ...row }) => [
            d.insert(authors).values({ ...row, createdAt: at, updatedAt: at }),
            d.insert(activityEvents).values({
              id: activityId,
              entityType: "author",
              entityId: row.id,
              eventKey: "author.created",
              metadata: { newValue: row.name },
              createdAt: at,
            }),
          ]),
          ...(plan.series.length
            ? [
                d.insert(series).values(
                  plan.series.map((row) => ({
                    ...row,
                    createdAt: at,
                    updatedAt: at,
                  })),
                ),
              ]
            : []),
          ...prepared.flatMap(({ entry, work, edition }) => [
            d
              .delete(ebookMatchCandidates)
              .where(eq(ebookMatchCandidates.ebookId, entry.effect.ebookId)),
            ...work.queries(d),
            ...edition.queries(d),
            d.insert(workStatusHistory).values({
              id: entry.receipt.historyIdsCreated[0],
              workId: entry.workId,
              fromStatus: null,
              toStatus: "accessioned",
              changedAt: at,
              notes: `ebook operation ${entry.receipt.operationId}`,
            }),
            d.insert(instances).values({
              ...entry.effect.copy!,
              id: entry.instanceId,
              editionId: entry.editionId,
              createdAt: at,
              updatedAt: at,
            }),
            d.insert(instanceStatusHistory).values({
              id: entry.receipt.historyIdsCreated[1],
              instanceId: entry.instanceId,
              fromStatus: null,
              toStatus: "available",
              changedAt: at,
              notes: `ebook operation ${entry.receipt.operationId}`,
            }),
            d.insert(activityEvents).values({
              id: entry.receipt.activityIdsCreated[2],
              entityType: "work",
              entityId: entry.workId,
              eventKey: "work.instance_added",
              metadata: { targetId: entry.instanceId },
              createdAt: at,
            }),
            d
              .update(ebooks)
              .set({
                instanceId: entry.instanceId,
                matchState: "linked",
                matchMethod: "manual",
                matchProbability: null,
                matchedAt: at,
                matchFingerprint: entry.metadataFingerprint,
                matchModelVersion: MATCH_MODEL.version,
                matchTier: null,
                duplicateOfId: null,
                exclusionReason: null,
                updatedAt: at,
              })
              .where(eq(ebooks.id, entry.effect.ebookId)),
          ]),
          d.execute(sql`select refresh_all_publisher_links()`),
          ...prepared.map(({ entry }) => commitReceiptQuery(d, entry.receipt)),
          ...(extension?.after(d) ?? []),
        ];
      }),
    );
    const followUpFailures: { workId: string; error: string }[] = [];
    for (const entry of plan.entries) {
      let queued: Awaited<ReturnType<typeof queueNewBookEnrichment>>;
      try {
        queued = await queueNewBookEnrichment(entry.workId, {
          priority: BULK_ACCESSION_PRIORITY,
          conn,
          matchingOperationId: entry.receipt.operationId,
        });
      } catch (error) {
        followUpFailures.push({ workId: entry.workId,
          error: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (!queued.ok)
        followUpFailures.push({ workId: entry.workId, error: queued.error });
      else {
        const jobs = queued.jobs
          .filter(
            (job) =>
              job.payload.matchingOperationId === entry.receipt.operationId &&
              job.status === "queued" &&
              job.attempts === 0,
          )
          .map((job) => job.rowSnapshot);
        if (jobs.length)
          try {
            await conn.execute(sql`update ebooks set link_written=jsonb_set(link_written,'{after,ownedChildren,enrichment_jobs}',${JSON.stringify(jobs)}::jsonb)
        where id=${entry.effect.ebookId}::uuid and instance_id=${entry.instanceId}::uuid and link_written->>'operationId'=${entry.receipt.operationId}
        and not exists(select 1 from jsonb_array_elements(${JSON.stringify(jobs)}::jsonb) saved where not exists(select 1 from enrichment_jobs j where to_jsonb(j)=saved))`);
          } catch (error) {
            followUpFailures.push({
              workId: entry.workId,
              error: `Could not record queued-job ownership: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
      }
    }
    try {
      await options.afterCommit?.({
        workIds: plan.entries.map((entry) => entry.workId),
        editionIds: plan.entries.map((entry) => entry.editionId),
      });
    } catch (error) {
      followUpFailures.push({
        workId: "batch",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      result,
      receipts: prepared.map(({ entry }) => entry.receipt),
      followUpFailures,
    };
  } catch (error) {
    for (const coverPlan of coverPlans)
      if (coverPlan) await discardUnusedCover(conn, coverPlan).catch(() => {});
    throw error;
  }
}
