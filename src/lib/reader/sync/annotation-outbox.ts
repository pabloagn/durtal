import type { AnnotationMutation, ReaderAnnotation } from "../annotations";
import { ANNOTATION_BATCH_LIMIT } from "../annotations";
import type {
  AnnotationDeleteRequest,
  AnnotationUpsert,
} from "@/lib/validations/annotations";

import { assertAnnotationDeleteEffect } from "../annotation-deletion";

export const ANNOTATION_TRANSPORT_BATCH_LIMIT = 100;
export const ANNOTATION_UNDO_MS = 10_000;
/** Leave room below the browser's 64 KiB lifecycle body quota. */
export const ANNOTATION_KEEPALIVE_BYTES = 60 * 1024;

export interface PendingAnnotation {
  /** Captured by the shared-store codec, preserved across every local reducer. */
  transportIdentity?: {
    fileId: string;
    expectedDeviceId: string;
    createdAt: string;
  };
  ebookId: string;
  operationId: string;
  revision: number;
  /** Null only for a newly created offline mark, not an edit of a known mark. */
  baseVersion: string | null;
  mutation: AnnotationMutation;
  stage: "pending" | "undoable" | "sealed" | "claimed";
  undoUntil: number | null;
  snapshot: ReaderAnnotation | null;
  claim: { token: string; until: number } | null;
}

/** These transitions must run inside ONE IndexedDB readwrite transaction.
 * No caller may cache an undoable row, send before persisting its claim, or
 * overwrite a claimed revision. A later edit gets a separate operation row.
 * One injected transport owns all replay, including the eventual SLN-507 OfflineStore.
 * Auth/network failures retain original revisions and timestamps; they do not
 * create a second annotations-only replayer. This module defines policy only; the actual IDB coordinator is integration work.
 */
export function pendingAnnotation(input: {
  ebookId: string;
  operationId: string;
  revision: number;
  mutation: AnnotationMutation;
  now: number;
  baseVersion: string | null;
  snapshot?: ReaderAnnotation | null;
}): PendingAnnotation {
  if (
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !Number.isFinite(input.now)
  )
    throw new Error("Invalid annotation outbox revision or time");
  const deleting = input.mutation.op === "delete";
  if (
    deleting &&
    (!input.snapshot ||
      input.snapshot.id !== input.mutation.id ||
      input.snapshot.ebookId !== input.ebookId)
  )
    throw new Error("An undoable delete needs its annotation snapshot");
  if (input.mutation.op === "delete")
    assertAnnotationDeleteEffect(
      input.snapshot!,
      input.mutation.quoteEffect ?? { action: "none" },
    );
  return {
    ebookId: input.ebookId,
    operationId: input.operationId,
    revision: input.revision,
    baseVersion: input.baseVersion,
    mutation: input.mutation,
    stage: deleting ? "undoable" : "pending",
    undoUntil: deleting ? input.now + ANNOTATION_UNDO_MS : null,
    snapshot: deleting ? input.snapshot! : null,
    claim: null,
  };
}

export function undoPendingAnnotation(
  row: PendingAnnotation,
  now: number,
):
  | { undone: true; snapshot: ReaderAnnotation; row: null }
  | { undone: false; row: PendingAnnotation } {
  if (!Number.isFinite(now)) throw new Error("Invalid annotation undo time");
  if (
    row.stage !== "undoable" ||
    row.mutation.op !== "delete" ||
    !row.snapshot ||
    row.undoUntil === null
  )
    return { undone: false, row };
  if (now >= row.undoUntil)
    return { undone: false, row: { ...row, stage: "sealed" } };
  return { undone: true, snapshot: row.snapshot, row: null };
}

/** Sealing is irreversible, even when an attempt fails or its lease expires. */
export function claimPendingAnnotation(
  row: PendingAnnotation,
  input: {
    now: number;
    token: string;
    hidden: boolean;
    leaseMs?: number;
  },
): PendingAnnotation | null {
  const { now, token, hidden, leaseMs = 30_000 } = input;
  if (
    !Number.isFinite(now) ||
    !token ||
    !Number.isFinite(leaseMs) ||
    leaseMs <= 0
  )
    throw new Error("Invalid annotation outbox claim");
  if (row.claim && row.claim.until > now) return null;
  if (
    row.stage === "undoable" &&
    !hidden &&
    row.undoUntil !== null &&
    now < row.undoUntil
  )
    return null;
  return { ...row, stage: "claimed", claim: { token, until: now + leaseMs } };
}

export function releaseAnnotationClaim(
  row: PendingAnnotation,
  token: string,
): PendingAnnotation {
  if (row.claim?.token !== token) return row;
  return {
    ...row,
    stage: row.mutation.op === "delete" ? "sealed" : "pending",
    claim: null,
  };
}

/** Only a response for the exact transmitted revision may remove its row. */
export function acknowledgeAnnotationClaim(
  row: PendingAnnotation,
  ack: {
    operationId: string;
    revision: number;
    token: string;
  },
): PendingAnnotation | null {
  return row.operationId === ack.operationId &&
    row.revision === ack.revision &&
    row.claim?.token === ack.token
    ? null
    : row;
}

export type AnnotationDeleteFinalizationResult = {
  operationId: string;
  revision: number;
  token: string;
} & (
  | { status: "committed" | "already-retired" }
  | { status: "conflict"; reason: string }
);

/** A composed conflict acknowledges neither effect. Keep the whole sealed row;
 * a stale response cannot release the current claim or remove a later revision.
 */
export function settleAnnotationDeleteClaim(
  row: PendingAnnotation,
  result: AnnotationDeleteFinalizationResult,
): PendingAnnotation | null {
  if (row.mutation.op !== "delete") throw new Error("Not an annotation delete");
  if (acknowledgeAnnotationClaim(row, result) !== null) return row;
  return result.status === "conflict"
    ? releaseAnnotationClaim(row, result.token)
    : null;
}

export interface AnnotationRequestPlan {
  body: { upserts: AnnotationUpsert[]; deletes: AnnotationDeleteRequest[] };
  json: string;
  bytes: number;
  operations: { operationId: string; revision: number; token: string }[];
}

/** Pure wire serialization, independent of shared queue claim ownership. */
export function annotationOperationBody(
  row: Pick<PendingAnnotation, "mutation" | "operationId" | "revision">,
): AnnotationRequestPlan["body"] {
  return row.mutation.op === "delete"
    ? {
        upserts: [],
        deletes: [
          {
            id: row.mutation.id,
            clientUpdatedAt: row.mutation.clientUpdatedAt,
            quoteEffect: row.mutation.quoteEffect ?? { action: "none" },
            operationId: row.operationId,
            revision: row.revision,
          },
        ],
      }
    : { upserts: [row.mutation], deletes: [] };
}

/** Serialize each logical mutation whole. Oversized lifecycle items are deferred,
 * never split, truncated or acknowledged. Callers release their claims durably.
 * Requests are sent sequentially; failures leave their rows for a later retry.
 * At most one operation per annotation is selected in a flush: later dependent
 * note/reanchor edits wait for acknowledgment of the preceding operation.
 */
export function planAnnotationRequests(
  ebookId: string,
  rows: PendingAnnotation[],
  mode: "foreground" | "lifecycle",
  byteLimit = ANNOTATION_KEEPALIVE_BYTES,
  itemLimit = ANNOTATION_TRANSPORT_BATCH_LIMIT,
): { requests: AnnotationRequestPlan[]; deferred: PendingAnnotation[] } {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1)
    throw new Error("Invalid annotation byte budget");
  if (
    !Number.isSafeInteger(itemLimit) ||
    itemLimit < 1 ||
    itemLimit > ANNOTATION_BATCH_LIMIT
  )
    throw new Error("Invalid annotation item budget");
  const requests: AnnotationRequestPlan[] = [],
    deferred: PendingAnnotation[] = [];
  const seen = new Set<string>();
  let selected: PendingAnnotation[] = [];
  const serialize = (items: PendingAnnotation[]): AnnotationRequestPlan => {
    const body: AnnotationRequestPlan["body"] = { upserts: [], deletes: [] };
    for (const row of items) {
      const item = annotationOperationBody(row);
      body.upserts.push(...item.upserts);
      body.deletes.push(...item.deletes);
    }
    const json = JSON.stringify(body);
    return {
      body,
      json,
      bytes: new TextEncoder().encode(json).byteLength,
      operations: items.map((row) => ({
        operationId: row.operationId,
        revision: row.revision,
        token: row.claim!.token,
      })),
    };
  };
  const flush = () => {
    if (selected.length) requests.push(serialize(selected));
    selected = [];
  };
  for (const row of [...rows].sort(
    (a, b) =>
      a.revision - b.revision || a.operationId.localeCompare(b.operationId),
  )) {
    if (row.ebookId !== ebookId)
      throw new Error("An annotation request cannot mix e-books");
    if (row.stage !== "claimed" || !row.claim || seen.has(row.mutation.id)) {
      deferred.push(row);
      seen.add(row.mutation.id);
      continue;
    }
    seen.add(row.mutation.id);
    if (mode === "lifecycle" && serialize([row]).bytes > byteLimit) {
      deferred.push(row);
      continue;
    }
    if (
      selected.length >= itemLimit ||
      (mode === "lifecycle" && serialize([...selected, row]).bytes > byteLimit)
    )
      flush();
    selected.push(row);
  }
  flush();
  return { requests, deferred };
}
