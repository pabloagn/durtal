import {
  annotationItems,
  deviceReplayPolicy,
  mutationKey,
  mutationWireJson,
  OFFLINE_ANNOTATION_LIMIT,
  type AnnotationMutation,
  type ReaderMutation,
} from "./mutations";

export const OUTBOX_KEEPALIVE_BYTES = 60 * 1024;
export const OUTBOX_CLAIM_MS = 30_000;
export interface OutboxRow {
  seq: number;
  mutation: ReaderMutation;
  attempts: number;
  state: "waiting" | "claimed" | "blocked";
  claim: { token: string; expiresAt: number } | null;
}
export interface OperationReference {
  seq: number;
  operationId: string;
  revision: number;
  token: string;
  ebookId: string;
  fileId: string;
  deviceId: string;
  wireJson: string;
}
export type BlockedOperationReference = Omit<OperationReference, "token"> & {
  attempts: number;
};
const ordered = (rows: readonly OutboxRow[]) => {
  const result = [...rows].sort((a, b) => a.seq - b.seq);
  if (
    result.some(
      (row) =>
        !Number.isSafeInteger(row.seq) ||
        row.seq < 1 ||
        !Number.isSafeInteger(row.attempts) ||
        row.attempts < 0 ||
        (row.state === "claimed") !== (row.claim !== null) ||
        (row.claim !== null &&
          (!row.claim.token || !Number.isFinite(row.claim.expiresAt))),
    ) ||
    new Set(result.map((row) => row.seq)).size !== result.length ||
    new Set(result.map((row) => row.mutation.operationId)).size !==
      result.length
  )
    throw new Error("Invalid outbox rows");
  return result;
};
/** Called inside the enqueue transaction. Claimed/blocked rows are never rewritten. */
export function coalescePositions(rows: readonly OutboxRow[]): {
  keep: OutboxRow[];
  removeSeqs: number[];
} {
  const sorted = ordered(rows);
  const groups = new Map<string, OutboxRow[]>();
  for (const row of sorted)
    if (row.state === "waiting" && row.mutation.kind === "position") {
      const key = mutationKey(row.mutation);
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
  const newer = (a: OutboxRow, b: OutboxRow) => {
    if (a.mutation.kind !== "position" || b.mutation.kind !== "position")
      throw new Error("Expected position");
    const left = positionTime(a.mutation.body.clientUpdatedAt),
      right = positionTime(b.mutation.body.clientUpdatedAt);
    return left > right || (left === right && a.seq > b.seq);
  };
  const retain = new Set<number>();
  for (const group of groups.values()) {
    let milestone = group[0],
      latest = group[0];
    for (const row of group) {
      const progression =
        row.mutation.kind === "position"
          ? row.mutation.body.locator.totalProgression
          : -1;
      const high =
        milestone.mutation.kind === "position"
          ? milestone.mutation.body.locator.totalProgression
          : -1;
      if (progression > high || (progression === high && newer(row, milestone)))
        milestone = row;
      if (newer(row, latest)) latest = row;
    }
    retain.add(milestone.seq);
    retain.add(latest.seq);
  }
  const removeSeqs = sorted
    .filter(
      (row) =>
        row.state === "waiting" &&
        row.mutation.kind === "position" &&
        !retain.has(row.seq),
    )
    .map((row) => row.seq);
  const remove = new Set(removeSeqs);
  return { keep: sorted.filter((row) => !remove.has(row.seq)), removeSeqs };
}
export type ClaimPlan =
  | {
      kind: "stop";
      reason:
        | "hidden"
        | "unreachable"
        | "empty"
        | "busy"
        | "blocked"
        | "lifecycle_body_too_large"
        | "device_identity_missing"
        | "device_identity_changed";
    }
  | {
      kind: "claim";
      rows: OutboxRow[];
      body: ReaderMutation["body"];
      json: string;
      references: OperationReference[];
    };
/** Selection/claims must commit atomically under the origin's sole replay lock.
 * An expired claim is reclaimed only after its former request deadline elapsed.
 */
export function planReplayClaim(
  rows: readonly OutboxRow[],
  options: {
    visible: boolean;
    reachable: boolean;
    currentDeviceId: string | null;
    nowMs: number;
    token: string;
    mode: "foreground" | "lifecycle";
  },
): ClaimPlan {
  if (!Number.isFinite(options.nowMs) || !options.token)
    throw new Error("Invalid replay claim");
  if (!options.visible && options.mode !== "lifecycle")
    return { kind: "stop", reason: "hidden" };
  if (!options.reachable) return { kind: "stop", reason: "unreachable" };
  const sorted = ordered(rows);
  if (!sorted.length) return { kind: "stop", reason: "empty" };
  const first = sorted[0];
  if (first.state === "blocked") return { kind: "stop", reason: "blocked" };
  if (first.claim && first.claim.expiresAt > options.nowMs)
    return { kind: "stop", reason: "busy" };
  const device = deviceReplayPolicy(
    first.mutation.deviceId,
    options.currentDeviceId,
  );
  if (device !== "ready") return { kind: "stop", reason: device };
  let selected = [first];
  let body = first.mutation.body;
  let json = mutationWireJson(first.mutation);
  if (options.mode === "lifecycle" && bytes(json) > OUTBOX_KEEPALIVE_BYTES)
    return { kind: "stop", reason: "lifecycle_body_too_large" };
  if (first.mutation.kind === "annotations" && first.mutation.batchable) {
    const ids = new Set(
      annotationItems(first.mutation).map((item) =>
        String(item.id).toLowerCase(),
      ),
    );
    let count = ids.size;
    for (const next of sorted.slice(1)) {
      const mutation = next.mutation;
      if (
        next.state !== "waiting" ||
        mutation.kind !== "annotations" ||
        !mutation.batchable ||
        mutation.ebookId.toLowerCase() !==
          first.mutation.ebookId.toLowerCase() ||
        mutation.deviceId.toLowerCase() !==
          first.mutation.deviceId.toLowerCase()
      )
        break;
      const newIds = annotationItems(mutation).map((item) =>
        String(item.id).toLowerCase(),
      );
      if (
        count + newIds.length > OFFLINE_ANNOTATION_LIMIT ||
        newIds.some((id) => ids.has(id))
      )
        break;
      const candidate: AnnotationMutation["body"] = {
        upserts: [
          ...(body as AnnotationMutation["body"]).upserts,
          ...mutation.body.upserts,
        ],
        deletes: [
          ...(body as AnnotationMutation["body"]).deletes,
          ...mutation.body.deletes,
        ],
      };
      const candidateJson = JSON.stringify(candidate);
      if (
        options.mode === "lifecycle" &&
        bytes(candidateJson) > OUTBOX_KEEPALIVE_BYTES
      )
        break;
      selected = [...selected, next];
      body = candidate;
      json = candidateJson;
      newIds.forEach((id) => ids.add(id));
      count += newIds.length;
    }
  }
  const claimed = selected.map((row) => ({
    ...row,
    state: "claimed" as const,
    claim: { token: options.token, expiresAt: options.nowMs + OUTBOX_CLAIM_MS },
  }));
  return {
    kind: "claim",
    rows: claimed,
    body,
    json,
    references: claimed.map(referenceFor),
  };
}
function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
function referenceFor(row: OutboxRow): OperationReference {
  return {
    seq: row.seq,
    operationId: row.mutation.operationId,
    revision: row.mutation.revision,
    token: row.claim!.token,
    ebookId: row.mutation.ebookId,
    fileId: row.mutation.fileId,
    deviceId: row.mutation.deviceId,
    wireJson: mutationWireJson(row.mutation),
  };
}
/** Acknowledgment/release may affect only this persisted immutable claim. */
export function matchesClaim(
  row: OutboxRow,
  reference: OperationReference,
): boolean {
  return (
    row.state === "claimed" &&
    row.claim?.token === reference.token &&
    matchesOperation(row, reference)
  );
}
function matchesOperation(
  row: OutboxRow,
  reference: Omit<OperationReference, "token">,
): boolean {
  return (
    row.seq === reference.seq &&
    row.mutation.operationId === reference.operationId &&
    row.mutation.revision === reference.revision &&
    row.mutation.ebookId === reference.ebookId &&
    row.mutation.fileId === reference.fileId &&
    row.mutation.deviceId === reference.deviceId &&
    mutationWireJson(row.mutation) === reference.wireJson
  );
}
/** Explicitly reconcile authentication before calling this inside a transaction.
 * Visibility, reachability and device probes alone must never unblock a row.
 * The attempt snapshot prevents an old reconciliation from clearing a new block.
 */
export function reconcileBlocked(
  row: OutboxRow,
  reference: BlockedOperationReference,
  currentDeviceId: string | null,
): OutboxRow {
  if (
    row.state !== "blocked" ||
    row.attempts !== reference.attempts ||
    !matchesOperation(row, reference) ||
    deviceReplayPolicy(row.mutation.deviceId, currentDeviceId) !== "ready"
  )
    return row;
  return { ...row, state: "waiting" };
}
/** This browser's queue moves to the device id its cookie now carries. Two
 * reader pages opened at once on a fresh browser each mint an id, and the
 * browser keeps only the last one; the outbox and the cookie share one
 * profile and origin, so a row under the superseded id is this device's own
 * unsent work (SLN-668). Claimed rows stay with their claimant.
 */
export function adoptDevice(
  row: OutboxRow,
  superseded: string,
  current: string,
): OutboxRow {
  if (
    row.state === "claimed" ||
    deviceReplayPolicy(superseded, current) !== "device_identity_changed" ||
    row.mutation.deviceId.toLowerCase() !== superseded.toLowerCase()
  )
    return row;
  return {
    ...row,
    mutation: { ...row.mutation, deviceId: current.toLowerCase() },
    state: "waiting",
  };
}
export function releaseClaim(
  row: OutboxRow,
  reference: OperationReference,
  blocked = false,
): OutboxRow {
  if (!matchesClaim(row, reference)) return row;
  return {
    ...row,
    state: blocked ? "blocked" : "waiting",
    claim: null,
    attempts: Math.min(Number.MAX_SAFE_INTEGER, row.attempts + 1),
  };
}
export type ReplayOutcome =
  | "acknowledge"
  | "inspect_annotations"
  | "reject"
  | "retry"
  | "blocked";
export function replayOutcome(
  status: number | null,
  code?: string,
  kind: ReaderMutation["kind"] = "position",
): ReplayOutcome {
  if (
    code === "device_identity_changed" ||
    code === "device_identity_missing" ||
    status === 401 ||
    status === 403
  )
    return "blocked";
  if (status !== null && status >= 200 && status < 300)
    return kind === "annotations" ? "inspect_annotations" : "acknowledge";
  if (status === 400 || status === 404 || status === 409 || status === 422)
    return "reject";
  return "retry";
}
/** This returns a scheduling decision, never creates a timer. */
export function replayDelay(
  attempts: number,
  visible: boolean,
  retryAfterMs?: number,
): number | null {
  if (!Number.isSafeInteger(attempts) || attempts < 0)
    throw new Error("Invalid retry count");
  if (!visible) return null;
  const base = [30_000, 60_000, 120_000, 300_000][Math.min(attempts, 3)];
  if (retryAfterMs === undefined) return base;
  if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0)
    throw new Error("Invalid retry delay");
  return Math.min(300_000, Math.max(base, retryAfterMs));
}

export function comparePositionTimes(left: string, right: string): number {
  const a = positionTime(left),
    b = positionTime(right);
  return a > b ? 1 : a < b ? -1 : 0;
}
/** Preserve sub-millisecond ordering without altering the original ISO string. */
function positionTime(value: string): bigint {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) throw new Error("Invalid original position time");
  return (
    BigInt(Date.parse(match[1] + match[3])) * BigInt(1000) +
    BigInt((match[2] ?? "").padEnd(6, "0"))
  );
}

export interface AnnotationItemOutcome {
  id: string;
  kind: "applied" | "ignored";
  reason?: string;
}
/** The annotation owner decodes its response. A 2xx alone cannot acknowledge
 * marks: unknown/duplicate/missing results preserve every original claim.
 */
export function annotationAcknowledgments(
  references: readonly OperationReference[],
  outcomes: readonly AnnotationItemOutcome[],
): { reference: OperationReference; ignored: AnnotationItemOutcome[] }[] {
  const itemsByReference = references.map((reference) => {
    const body = JSON.parse(reference.wireJson) as AnnotationMutation["body"];
    if (!Array.isArray(body.upserts) || !Array.isArray(body.deletes))
      throw new Error("Expected annotation reference");
    return {
      reference,
      ids: [...body.upserts, ...body.deletes].map((item) =>
        String(item.id).toLowerCase(),
      ),
    };
  });
  const ids = itemsByReference.flatMap((item) => item.ids);
  const replies = new Map(
    outcomes.map((outcome) => [outcome.id.toLowerCase(), outcome]),
  );
  if (
    new Set(ids).size !== ids.length ||
    replies.size !== outcomes.length ||
    outcomes.length !== ids.length ||
    ids.some((id) => !replies.has(id)) ||
    outcomes.some((item) => item.kind === "ignored" && !item.reason)
  )
    throw new Error("Incomplete annotation acknowledgment");
  return itemsByReference.map(({ reference, ids }) => ({
    reference,
    ignored: ids
      .map((id) => replies.get(id)!)
      .filter((item) => item.kind === "ignored"),
  }));
}
