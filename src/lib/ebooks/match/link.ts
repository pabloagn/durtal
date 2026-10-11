import type { AllocatedCoverStage, VerifiedCoverStage, CoverObjectEvidence } from "@/lib/s3/cover-stage";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { requireBookWork } from "@/lib/catalogue/book-boundary";
import { isbnClash } from "@/lib/catalogue/isbn-clash";
import { planBookEdition } from "@/lib/catalogue/book-store";
import { atomicOn } from "@/lib/db/atomic";
import { resultRows } from "@/lib/harmonization/store";
import { withReadableErrors } from "@/lib/db/errors";
import {
  activityEvents,
  ebooks,
  ebookMatchCandidates,
  instances,
  instanceStatusHistory,
} from "@/lib/db/schema";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { normalizeLanguage } from "@/lib/utils/language";
import { databaseFingerprint } from "../ingest/command";
import {
  loadMatchCatalogue,
  dataFingerprint,
  type LoadedMatchCatalogue,
  type StoredRow,
} from "./load";
import { editionEffect, preferredMatchFile, digitalCopyValues } from "./editions";
import { parseNewCopyDraft, parseNewEditionIntent, type NewCopyDraftInput, type NewEditionIntent } from "./manual-intents";
import { requireMatchAtomicExtension, type PreparedMatchAtomicExtension } from "./review-extension";
import { matchFingerprint } from "./keys";
import { scorePair } from "./score";
import { MATCH_MODEL } from "./model";
import { hashMatchingPlan } from "./plan";
import { snapshotGuardQueries, type AdditionalSnapshotRows } from "./guards";
import { requireMatchProbability } from "./validation";
import type { LinkEffect, MatchEbook, MatchOperationIdentity } from "./types";
import { requireApprovedGroupPlan, type ApprovedGroupMatching } from "./groups";
import { planCoverCopy, copyPlannedCover, discardUnusedCover, requireMatchingCover } from "./covers";

export interface LinkChoices {
  ebookId: string;
  workId: string;
  instanceId?: string;
  editionId?: string;
  locationId?: string;
  newEdition?: NewEditionIntent;
  newCopyDraft?: NewCopyDraftInput;
  method: "manual" | "isbn" | "identifier" | "score";
  probability?: number | null;
}
export interface LinkPlan extends MatchOperationIdentity {
  kind: "link";
  mode: "ingestion";
  modelFingerprint: string;
  createdAt: string;
  snapshot: Pick<
    LoadedMatchCatalogue,
    "rows" | "catalogueFingerprint" | "inputFingerprint"
  >;
  ebook: MatchEbook;
  effect: LinkEffect;
  choices: LinkChoices;
  editionId: string;
  instanceId: string;
  instanceHistoryId: string | null;
  activityId: string | null;
  editionActivityId: string | null;
  approvedGroupHash?: string;
  additionalSnapshotRows?: AdditionalSnapshotRows;
}
export interface CopyFillProvenance {
  fields: readonly ("format" | "file_size_bytes")[];
  expected: NonNullable<LinkEffect["filledCopy"]>;
}
/** Plans and receipt snapshots are DTOs. Make a private deep copy before an
 * await; freezing a Date/Map or a caller's top-level object would leave mutable
 * internal state or aliases. Reject accessors, cycles and non-DTO values. */
export function immutableMatchingWriterInput<T>(input: T): T {
  const visiting = new WeakSet<object>();
  const copy = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || value === null || visiting.has(value))
      throw new Error("Matching writer inputs require finite acyclic DTO values");
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null)
      throw new Error("Matching writer inputs cannot contain Date or other mutable internal values");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
        (array && (keys.length !== value.length + 1 ||
          Array.from({ length: value.length }, (_, i) => String(i)).some((key) => !Object.hasOwn(value, key)))))
      throw new Error("Matching writer inputs cannot contain sparse, augmented or symbol-keyed values");
    visiting.add(value);
    const result = array ? [] : Object.create(prototype);
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor) || !descriptor.enumerable)
        throw new Error("Matching writer inputs cannot contain accessors or hidden values");
      Object.defineProperty(result, key, { value: copy(descriptor.value), enumerable: true,
        writable: true, configurable: true });
    }
    visiting.delete(value);
    return Object.freeze(result);
  };
  return copy(input) as T;
}
export interface LinkReceipt extends MatchOperationIdentity {
  kind: "link" | "accession";
  ebookId: string;
  workId: string;
  instanceId: string;
  editionId: string;
  createdInstance: boolean;
  createdEdition: boolean;
  movedFromEditionId: string | null;
  fillProvenance?: CopyFillProvenance;
  workCreated: boolean;
  authorIdsCreated: readonly string[];
  seriesIdCreated: string | null;
  historyIdsCreated: readonly string[];
  activityIdsCreated: readonly string[];
  coverArtifacts?: readonly string[];
  /** Optional: old persisted receipts remain readable. Reservation precedes PUT;
   * verified output hashes are persisted with this same operation on commit. */
  coverStage?: {
    state: "reserved" | "verified";
    allocation: AllocatedCoverStage;
    cover?: CoverObjectEvidence;
    thumbnail?: CoverObjectEvidence;
  };
  approvedGroupHash?: string;
  before: {
    ebook: StoredRow;
    instance: StoredRow | null;
    originalEdition?: StoredRow;
    candidates: readonly StoredRow[];
  };
  /** The transaction fills these full JSON row snapshots, without recursion. */
  after?: {
    ebook: StoredRow;
    instance: StoredRow;
    edition: StoredRow;
    work: StoredRow;
    authors: readonly StoredRow[];
    series: StoredRow | null;
    histories: readonly StoredRow[];
    activities: readonly StoredRow[];
    ownedChildren: Readonly<Record<string, readonly StoredRow[]>>;
  };
}
export async function planLinkOn(
  conn: Db,
  input: LinkChoices,
  identity: { runId: string; targetDatabase: string; now?: string },
): Promise<LinkPlan> {
  requireMatchProbability(input.probability ?? null);
  if (input.method !== "manual" && (input.newEdition !== undefined || input.newCopyDraft !== undefined))
    throw new Error("Manual edition and copy intents cannot authorize an automatic link");
  const choices: LinkChoices = {
    ...input,
    ...(input.newEdition !== undefined ? { newEdition: parseNewEditionIntent(input.newEdition) } : {}),
    ...(input.newCopyDraft !== undefined ? { newCopyDraft: parseNewCopyDraft(input.newCopyDraft) } : {}),
  };
  const loaded = await loadMatchCatalogue(conn);
  await requireBookWork(input.workId, conn);
  const work = loaded.catalogue.byWorkId.get(input.workId);
  const ebook = loaded.catalogue.source.ebooks.find(
    (row) => row.id === input.ebookId,
  );
  if (!work || !ebook || ebook.instanceId || ebook.matchState === "linked")
    throw new Error("Choose an existing unlinked ebook and book");
  const effect = editionEffect(ebook, work, loaded.catalogue, choices);
  const score = scorePair(ebook, work, loaded.catalogue);
  if (score.identifierConflict)
    throw new Error(
      "An identifier contradicts this book; review metadata before linking",
    );
  if (!effect.ready) throw new Error(effect.text);
  if (choices.newCopyDraft !== undefined && (!effect.newCopy || effect.instanceId))
    throw new Error("A copy draft requires a newly planned copy");
  let additionalSnapshotRows: AdditionalSnapshotRows | undefined;
  if (choices.newCopyDraft?.subLocationId) {
    const rows = resultRows<{ row: StoredRow }>(await conn.execute(sql`
      select to_jsonb(r) row from sub_locations r order by to_jsonb(r)::text`)).map(({ row }) => row);
    if (!rows.some((row) => row.id === choices.newCopyDraft!.subLocationId &&
        row.location_id === effect.newCopy!.locationId))
      throw new Error("The chosen sub-location must belong to the new copy's location");
    additionalSnapshotRows = { sub_locations: rows };
  }
  if (effect.newEdition?.isbn13) {
    const clash = await isbnClash(
      { isbn13: effect.newEdition.isbn13 },
      undefined,
      conn,
    );
    if (clash) throw new Error(clash);
  }
  if (input.method !== "manual")
    throw new Error(
      "Automatic links require the approved group/calibration apply boundary",
    );
  const plan: LinkPlan = {
    version: 1,
    operationId: randomUUID(),
    runId: identity.runId,
    planSha256: "",
    targetDatabase: identity.targetDatabase,
    kind: "link",
    mode: "ingestion",
    createdAt: identity.now ?? new Date().toISOString(),
    modelFingerprint: dataFingerprint(MATCH_MODEL),
    snapshot: {
      rows: loaded.rows,
      catalogueFingerprint: loaded.catalogueFingerprint,
      inputFingerprint: loaded.inputFingerprint,
    },
    ebook,
    effect,
    choices,
    ...(additionalSnapshotRows ? { additionalSnapshotRows } : {}),
    editionId: effect.editionId ?? randomUUID(),
    instanceId: effect.instanceId ?? randomUUID(),
    instanceHistoryId: effect.instanceId ? null : randomUUID(),
    activityId: effect.newCopy ? randomUUID() : null,
    editionActivityId: effect.newEdition ? randomUUID() : null,
  };
  plan.planSha256 = hashMatchingPlan(plan);
  return plan;
}
export async function planLink(
  url: string,
  input: LinkChoices,
  identity: { runId?: string; now?: string } = {},
) {
  return withReadOnlyPlanningConnection(
    url,
    (conn) =>
      planLinkOn(conn, input, {
        runId: identity.runId ?? randomUUID(),
        targetDatabase: databaseFingerprint(url),
        now: identity.now,
      }),
    { isolationLevel: "repeatable read" },
  );
}
export function linkUndoEntry(plan: LinkPlan): LinkReceipt {
  const before = plan.snapshot.rows.ebooks.find(
    (row) => row.id === plan.ebook.id,
  );
  if (!before)
    throw new Error("Link plan is missing its original ebook snapshot");
  const originalEdition = plan.effect.movedFromEditionId
    ? plan.snapshot.rows.editions.find((row) => row.id === plan.effect.movedFromEditionId) : undefined;
  if (plan.effect.movedFromEditionId && !originalEdition && plan.choices.method === "manual")
    throw new Error("Link plan is missing the moved copy's original edition snapshot");
  return {
    version: 1,
    operationId: plan.operationId,
    runId: plan.runId,
    planSha256: plan.planSha256,
    targetDatabase: plan.targetDatabase,
    kind: "link",
    ebookId: plan.ebook.id,
    workId: plan.effect.workId,
    instanceId: plan.instanceId,
    editionId: plan.editionId,
    createdInstance: !!plan.effect.newCopy,
    createdEdition: !!plan.effect.newEdition,
    movedFromEditionId: plan.effect.movedFromEditionId,
    ...(plan.effect.filledCopy ? {
      fillProvenance: {
        fields: (["format", "file_size_bytes"] as const).filter((field) => {
          const original = plan.snapshot.rows.instances.find((row) => row.id === plan.instanceId);
          return original?.[field] !== (field === "format" ? plan.effect.filledCopy!.format : plan.effect.filledCopy!.fileSizeBytes);
        }),
        expected: { ...plan.effect.filledCopy },
      },
    } : {}),
    workCreated: false,
    authorIdsCreated: [],
    seriesIdCreated: null,
    historyIdsCreated: plan.instanceHistoryId ? [plan.instanceHistoryId] : [],
    activityIdsCreated: [
      ...(plan.activityId ? [plan.activityId] : []),
      ...(plan.editionActivityId ? [plan.editionActivityId] : []),
    ],
    ...(plan.approvedGroupHash
      ? { approvedGroupHash: plan.approvedGroupHash }
      : {}),
    before: {
      ebook: before,
      instance: plan.effect.instanceId
        ? (plan.snapshot.rows.instances.find(
            (row) => row.id === plan.effect.instanceId,
          ) ?? null)
        : null,
      candidates: plan.snapshot.rows.ebook_match_candidates.filter(
        (row) => row.ebook_id === plan.ebook.id,
      ),
      ...(originalEdition ? { originalEdition } : {}),
    },
  };
}
/** Captures full committed row values inside the atomic, not a later read.
 * The same bound identity is in reserved CLI undo entries and DB provenance. */
export function commitReceiptQuery(d: Db, receipt: LinkReceipt) {
  // Approved group plans carry only per-link receipt rows. Their outer writer
  // guards the full catalogue; the unchanged original edition is captured here
  // under those same locks, without widening the automatic planning API.
  const receiptJson = receipt.movedFromEditionId && !receipt.before.originalEdition
    ? sql`jsonb_set(${JSON.stringify(receipt)}::jsonb, '{before,originalEdition}',
        (select to_jsonb(original) from editions original where original.id=${receipt.movedFromEditionId}::uuid))`
    : sql`${JSON.stringify(receipt)}::jsonb`;
  return d.execute(sql`update ebooks eb set link_written = ${receiptJson} || jsonb_build_object('after', jsonb_build_object(
    'ebook', to_jsonb(eb) - 'link_written',
    'instance', (select to_jsonb(i) from instances i where i.id=${receipt.instanceId}::uuid),
    'edition', (select to_jsonb(e) from editions e where e.id=${receipt.editionId}::uuid),
    'work', (select to_jsonb(w) from works w where w.id=${receipt.workId}::uuid),
    'authors', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from authors a where a.id=any(${[...receipt.authorIdsCreated]}::uuid[])),
    'series', (select to_jsonb(s) from series s where s.id=${receipt.seriesIdCreated}::uuid),
    'histories', (select coalesce(jsonb_agg(row order by row::text), '[]'::jsonb) from (select to_jsonb(h) row from instance_status_history h where h.id=any(${[...receipt.historyIdsCreated]}::uuid[]) union all select to_jsonb(h) row from work_status_history h where h.id=any(${[...receipt.historyIdsCreated]}::uuid[])) h),
    'activities', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from activity_events a where a.id=any(${[...receipt.activityIdsCreated]}::uuid[])),
    'ownedChildren', jsonb_build_object(
      'work_authors', (select coalesce(jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),'[]'::jsonb) from work_authors c where ${receipt.workCreated} and c.work_id=${receipt.workId}::uuid),
      'person_domains', (select coalesce(jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),'[]'::jsonb) from person_domains c where c.person_id=any(${[...receipt.authorIdsCreated]}::uuid[]) and c.kind='book')
    )
  )) where eb.id=${receipt.ebookId}::uuid returning link_written`);
}
export async function prepareLinkWrite(
  plan: LinkPlan,
  runtimeTarget: string,
  options: {
    preparedCover?: VerifiedCoverStage | null;
    coverReservation?: AllocatedCoverStage;
    automaticApproval?: ApprovedGroupMatching;
  } = {},
) {
  plan = immutableMatchingWriterInput(plan);
  options = {
    ...options,
    // Issued cover capabilities are already deeply immutable; retain their registry identity.
    preparedCover: options.preparedCover,
    coverReservation: options.coverReservation,
    automaticApproval: immutableMatchingWriterInput(options.automaticApproval),
  };
  if (
    plan.kind !== "link" ||
    plan.version !== 1 ||
    plan.mode !== "ingestion" ||
    plan.targetDatabase !== runtimeTarget ||
    plan.modelFingerprint !== dataFingerprint(MATCH_MODEL) ||
    plan.planSha256 !== hashMatchingPlan(plan) ||
    !plan.effect.ready
  )
    throw new Error(
      "Link mode, target, model, hash or effect changed; nothing written",
    );
  requireMatchProbability(plan.choices.probability ?? null);
  if (plan.choices.method !== "manual" &&
      (plan.choices.newEdition !== undefined || plan.choices.newCopyDraft !== undefined))
    throw new Error("Manual edition and copy intents cannot authorize an automatic link");
  const draft = plan.choices.newCopyDraft === undefined ? undefined : parseNewCopyDraft(plan.choices.newCopyDraft);
  if (draft && (!plan.effect.newCopy || plan.effect.instanceId ||
      dataFingerprint(draft) !== dataFingerprint(plan.choices.newCopyDraft)))
    throw new Error("Frozen copy draft is invalid for this effect");
  if (plan.choices.newEdition !== undefined) {
    const intent = parseNewEditionIntent(plan.choices.newEdition);
    if (plan.choices.instanceId || plan.choices.editionId || !plan.effect.newEdition ||
        plan.effect.editionId || plan.effect.instanceId ||
        dataFingerprint(intent) !== dataFingerprint(plan.choices.newEdition) ||
        (intent.language ?? normalizeLanguage(plan.ebook.language)) !== plan.effect.newEdition.language ||
        plan.effect.rule !== (plan.effect.newEdition.isbn13 ? "new_isbn_edition" : "new_edition") ||
        (intent.isbn13 !== undefined && intent.isbn13 !== plan.effect.newEdition.isbn13))
      throw new Error("Frozen new-edition intent differs from its planned effect");
  }
  if (draft?.subLocationId && !plan.additionalSnapshotRows?.sub_locations?.some(
    (row) => row.id === draft.subLocationId && row.location_id === plan.effect.newCopy?.locationId,
  )) throw new Error("Frozen sub-location is missing or has another parent");
  if (plan.additionalSnapshotRows && !draft?.subLocationId)
    throw new Error("Additional reference snapshot has no copy draft choice");
  if (plan.choices.method === "manual" && plan.effect.newCopy &&
      !plan.snapshot.rows.locations.some((location) => location.id === plan.effect.newCopy!.locationId &&
        location.type === "digital" && location.is_active === true))
    throw new Error("Frozen new copy requires an active digital destination");
  if (plan.effect.filledCopy) {
    const file = preferredMatchFile(plan.ebook);
    const original = plan.snapshot.rows.instances.find((row) => row.id === plan.instanceId);
    if (!file || !original || plan.effect.instanceId !== plan.instanceId || plan.effect.newCopy ||
        original.status === "deaccessioned" ||
        original.edition_id !== (plan.effect.movedFromEditionId ?? plan.editionId) ||
        (plan.choices.method === "manual" && !plan.snapshot.rows.locations.some((location) =>
          location.id === original.location_id && location.type === "digital" && location.is_active === true)) ||
        plan.snapshot.rows.ebooks.some((row) => row.instance_id === plan.instanceId) ||
        dataFingerprint(plan.effect.filledCopy) !== dataFingerprint(digitalCopyValues(file)))
      throw new Error("Frozen fill differs from the usable file or existing unlinked copy");
  }
  if (plan.choices.method !== "manual") {
    const approval = options.automaticApproval;
    if (
      !approval?.precision ||
      plan.approvedGroupHash !== dataFingerprint(approval.plan)
    )
      throw new Error("Automatic link lacks the bound approved group plan");
    requireApprovedGroupPlan(approval);
    const approved = approval.plan.groups.find(
      (group) =>
        group.metadataFingerprint === matchFingerprint(plan.ebook) &&
        group.result.autoLink &&
        dataFingerprint(group.result.candidates[0]?.effect) ===
          dataFingerprint(plan.effect),
    );
    if (
      !approved ||
      approved.result.candidates[0].probability !== plan.choices.probability ||
      approved.result.candidates[0].workId !== plan.choices.workId ||
      (approved.result.candidates[0].identifierMethods[0] ?? "score") !== plan.choices.method
    )
      throw new Error("Automatic effect differs from the reviewed candidate");
  }
  const sourceKey = plan.effect.newEdition?.coverSourceKey ?? null;
  if (options.coverReservation)
    requireMatchingCover(plan.snapshot, plan.ebook.id, plan.editionId, sourceKey, plan, options.coverReservation, false);
  if (options.preparedCover) {
    requireMatchingCover(plan.snapshot, plan.ebook.id, plan.editionId, sourceKey, plan, options.preparedCover, true);
    if (options.coverReservation && options.coverReservation.attemptId !== options.preparedCover.attemptId)
      throw new Error("Completed cover differs from reserved attempt");
  }
  const at = new Date(plan.createdAt);
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid link timestamp");
  const timestamp = at.getTime();
  const { coverSourceKey: _coverSourceKey, ...editionValues } =
    plan.effect.newEdition ?? {};
  const editionPlan = plan.effect.newEdition
    ? await planBookEdition(
        { workId: plan.effect.workId, ...editionValues } as Parameters<
          typeof planBookEdition
        >[0],
        {
          id: plan.editionId,
          activityId: plan.editionActivityId!,
          at,
          cover: options.preparedCover ?? null,
        },
      )
    : null;
  const receipt: LinkReceipt = immutableMatchingWriterInput({
    ...linkUndoEntry(plan),
    ...((options.preparedCover ?? options.coverReservation)
      ? {
          coverArtifacts: [(options.preparedCover ?? options.coverReservation)!.coverKey,
            (options.preparedCover ?? options.coverReservation)!.thumbnailKey],
          coverStage: {
            state: options.preparedCover ? "verified" as const : "reserved" as const,
            allocation: options.coverReservation ?? options.preparedCover!,
            ...(options.preparedCover ? { cover: options.preparedCover.cover, thumbnail: options.preparedCover.thumbnail } : {}),
          },
        } : {}),
  });
  return {
    receipt,
    queries: (d: Db) => {
      if (at.getTime() !== timestamp)
        throw new Error("Prepared link timestamp changed; nothing written");
      if (options.coverReservation && !options.preparedCover)
        throw new Error("Reserved cover must complete verification before publication");
      return [
        d
          .delete(ebookMatchCandidates)
          .where(eq(ebookMatchCandidates.ebookId, plan.ebook.id)),
        ...(editionPlan?.queries(d) ?? []),
        ...(plan.effect.newCopy
          ? [
              d.insert(instances).values({
                ...draft,
                ...plan.effect.newCopy,
                id: plan.instanceId,
                editionId: plan.editionId,
                createdAt: at,
                updatedAt: at,
              }),
              d.insert(instanceStatusHistory).values({
                id: plan.instanceHistoryId!,
                instanceId: plan.instanceId,
                fromStatus: null,
                toStatus: "available",
                changedAt: at,
                notes: `ebook operation ${plan.operationId}`,
              }),
              d.insert(activityEvents).values({
                id: plan.activityId!,
                entityType: "work",
                entityId: plan.effect.workId,
                eventKey: "work.instance_added",
                metadata: { targetId: plan.instanceId },
                createdAt: at,
              }),
            ]
          : []),
        ...(plan.effect.movedFromEditionId || plan.effect.filledCopy
          ? [
              d
                .update(instances)
                .set({
                  ...(plan.effect.movedFromEditionId ? { editionId: plan.editionId } : {}),
                  ...plan.effect.filledCopy,
                  updatedAt: at,
                })
                .where(eq(instances.id, plan.instanceId)),
            ]
          : []),
        d
          .update(ebooks)
          .set({
            instanceId: plan.instanceId,
            matchState: "linked",
            matchMethod: plan.choices.method,
            matchProbability: plan.choices.probability ?? null,
            matchedAt: at,
            matchFingerprint: matchFingerprint(plan.ebook),
            matchModelVersion: MATCH_MODEL.version,
            matchTier: null,
            duplicateOfId: null,
            exclusionReason: null,
            updatedAt: at,
          })
          .where(eq(ebooks.id, plan.ebook.id)),
        commitReceiptQuery(d, receipt),
      ];
    },
  };
}
export async function linkEbook(
  conn: Db,
  plan: LinkPlan,
  runtimeTarget: string,
  options: Parameters<typeof prepareLinkWrite>[2] & {
    beforeWrite?: (entry: LinkReceipt) => Promise<void>;
    atomicExtension?: PreparedMatchAtomicExtension;
  } = {},
) {
  plan = immutableMatchingWriterInput(plan);
  options = {
    ...options,
    // Issued cover capabilities are already deeply immutable; retain their registry identity.
    preparedCover: options.preparedCover,
    coverReservation: options.coverReservation,
    automaticApproval: immutableMatchingWriterInput(options.automaticApproval),
  };
  const extension = requireMatchAtomicExtension(options.atomicExtension, {
    coreWriter: "link", coreOperation: plan, ebookIds: [plan.ebook.id],
  });
  if (extension && plan.choices.method !== "manual")
    throw new Error("Automatic links cannot consume review extensions");
  const coverPlan = options.preparedCover
    ? null
    : planCoverCopy(
        plan.snapshot,
        plan.ebook.id,
        plan.editionId,
        plan.effect.newEdition?.coverSourceKey ?? null,
        plan,
      );
  let prepared = await prepareLinkWrite(plan, runtimeTarget, {
    ...options,
    preparedCover: options.preparedCover,
    coverReservation: coverPlan?.allocation ?? options.coverReservation,
  });
  await options.beforeWrite?.(prepared.receipt);
  try {
    if (coverPlan)
      prepared = await prepareLinkWrite(plan, runtimeTarget, {
        ...options,
        coverReservation: coverPlan.allocation,
        preparedCover: await copyPlannedCover(coverPlan),
      });
    return await withReadableErrors(() =>
      atomicOn(conn, (d) => [
        ...snapshotGuardQueries(d, plan.snapshot, extension?.extraTables, plan.additionalSnapshotRows),
        ...(extension?.before(d) ?? []),
        ...prepared.queries(d),
        ...(extension?.after(d) ?? []),
      ]),
    );
  } catch (error) {
    if (coverPlan) await discardUnusedCover(conn, coverPlan).catch(() => {});
    throw error;
  }
}
