import { z } from "zod/v4";
import {
  annotationBodySchema,
  annotationRecordSchema,
} from "@/lib/validations/annotations";
import {
  createAnnotationTransport,
  type ReaderTransport,
  type ClaimedPlan,
} from "../offline/transport";
import type {
  AnnotationBook,
  DurableInput,
  StoredOperation,
} from "../offline/store";
import {
  validateMutation,
  type Json,
  type JsonObject,
} from "../offline/mutations";
import { annotationAcknowledgments } from "../offline/outbox-policy";
import { annotationOperationBody } from "./annotation-outbox";
import type { AnnotationMutation } from "../annotations";
import type { PendingAnnotation } from "./annotation-outbox";
import {
  serializeAnnotationOperation,
  type DurableAnnotationOperation,
} from "./annotation-transport";
import {
  compareAnnotationTimes,
  canonicalAnnotationTime,
} from "./annotation-time";

const json = (value: unknown): Json =>
  JSON.parse(JSON.stringify(value)) as Json;
const object = (value: unknown): JsonObject => json(value) as JsonObject;
export const validateSharedAnnotationBody = (body: unknown) =>
  annotationBodySchema().safeParse(body).success;
export function encodeSharedAnnotation(
  operation: Readonly<DurableAnnotationOperation>,
): DurableInput {
  const body = annotationBodySchema().parse(JSON.parse(operation.body));
  const mutation = validateMutation(
    {
      v: 1,
      kind: "annotations",
      operationId: operation.operationId,
      revision: operation.revision,
      ebookId: operation.ebookId,
      fileId: operation.fileId,
      deviceId: operation.expectedDeviceId,
      createdAt: operation.createdAt,
      body: object(body),
      batchable: !body.deletes.length,
    },
    { nowMs: Date.now(), annotations: validateSharedAnnotationBody },
  );
  return {
    mutation,
    annotation: {
      pending: object(operation.local),
      undo: operation.deleteUndo
        ? {
            ...operation.deleteUndo,
            snapshot: object(operation.deleteUndo.snapshot),
          }
        : null,
    },
  };
}
export function decodeSharedAnnotationPending(
  row: StoredOperation,
): PendingAnnotation {
  if (row.mutation.kind !== "annotations" || !row.annotation)
    throw new Error("Missing annotation owner state");
  const raw = row.annotation.pending;
  const body = annotationBodySchema().parse(row.mutation.body);
  const count = body.upserts.length + body.deletes.length;
  if (
    count !== 1 ||
    raw.ebookId !== row.mutation.ebookId ||
    raw.operationId !== row.mutation.operationId ||
    raw.revision !== row.mutation.revision
  )
    throw new Error(
      "Annotation owner identity differs from the durable operation",
    );
  const mutation: AnnotationMutation = body.upserts.length
    ? body.upserts[0]
    : {
        op: "delete",
        id: body.deletes[0].id,
        clientUpdatedAt: body.deletes[0].clientUpdatedAt,
        quoteEffect: body.deletes[0].quoteEffect,
      };
  const ownerBody = annotationOperationBody({
    mutation: raw.mutation as unknown as AnnotationMutation,
    operationId: row.mutation.operationId,
    revision: row.mutation.revision,
  });
  if (
    JSON.stringify(annotationBodySchema().parse(ownerBody)) !==
    JSON.stringify(body)
  )
    throw new Error(
      "Annotation owner payload differs from the durable operation",
    );
  const baseVersion =
    raw.baseVersion === null
      ? null
      : canonicalAnnotationTime(z.string().parse(raw.baseVersion));
  const undo = row.annotation.undo;
  const snapshot = undo ? annotationRecordSchema.parse(undo.snapshot) : null;
  const deleting = body.deletes.length > 0;
  if (deleting && (!undo || !snapshot || snapshot.id !== mutation.id))
    throw new Error("Missing durable deletion snapshot");
  return {
    ebookId: row.mutation.ebookId,
    operationId: row.mutation.operationId,
    revision: row.mutation.revision,
    baseVersion,
    mutation:
      mutation.op === "delete"
        ? {
            op: "delete",
            id: mutation.id,
            clientUpdatedAt: mutation.clientUpdatedAt,
            quoteEffect: mutation.quoteEffect,
          }
        : mutation,
    stage:
      row.state === "claimed"
        ? "claimed"
        : deleting
          ? undo!.state === "undoable"
            ? "undoable"
            : "sealed"
          : "pending",
    undoUntil: undo?.until ?? null,
    snapshot,
    claim: row.claim
      ? { token: row.claim.token, until: row.claim.expiresAt }
      : null,
    transportIdentity: {
      fileId: row.mutation.fileId,
      expectedDeviceId: row.mutation.deviceId,
      createdAt: row.mutation.createdAt,
    },
  };
}
export function encodeSharedAnnotationPending(
  row: PendingAnnotation,
): DurableInput {
  if (!row.transportIdentity)
    throw new Error("Missing captured annotation transport identity");
  return encodeSharedAnnotation(
    serializeAnnotationOperation(row, row.transportIdentity),
  );
}
export const sharedAnnotationTransport = (transport: ReaderTransport) =>
  createAnnotationTransport(transport, {
    encodeOperation: encodeSharedAnnotation,
    decodeAnnotation: (value: Json) => annotationRecordSchema.parse(value),
    encodeAnnotation: (value: z.output<typeof annotationRecordSchema>) =>
      json(value),
    decodePending: decodeSharedAnnotationPending,
    encodePending: encodeSharedAnnotationPending,
  });

const responseSchema = z.strictObject({
  applied: z.array(z.uuid()),
  annotations: z.array(annotationRecordSchema),
  ignored: z.array(z.strictObject({ id: z.uuid(), reason: z.string().min(1) })),
  serverTime: z.string().transform(canonicalAnnotationTime),
  operations: z
    .array(
      z.strictObject({
        operationId: z.string().min(1),
        revision: z.number().int().positive(),
      }),
    )
    .optional(),
});
/** A POST receipt never advances the pull cursor. Complete exact item outcomes
 * are required; a quote-version conflict retains the sealed whole operation.
 */
export function decodeAnnotationReceipt(input: unknown, plan: ClaimedPlan) {
  const response = responseSchema.parse(input);
  const outcomes = [
    ...response.applied.map((id) => ({ id, kind: "applied" as const })),
    ...response.ignored.map((item) => ({ ...item, kind: "ignored" as const })),
  ];
  annotationAcknowledgments(plan.references, outcomes);
  const deletes = plan.rows.flatMap((row) =>
    row.mutation.kind === "annotations" ? row.mutation.body.deletes : [],
  );
  for (const item of deletes) {
    if (
      item.quoteEffect &&
      (item.quoteEffect as JsonObject).action !== "none"
    ) {
      const echo = response.operations?.filter(
        (op) =>
          op.operationId === item.operationId && op.revision === item.revision,
      );
      if (echo?.length !== 1)
        throw new Error("Missing exact composed annotation operation receipt");
      const ignored = response.ignored.find(
        (outcome) => outcome.id === item.id,
      );
      if (
        ignored &&
        [
          "binding",
          "note-version",
          "binding-version",
          "quote-choice",
          "missing",
          "ownership",
          "identity",
        ].includes(ignored.reason)
      )
        throw new Error(`Sealed quote delete conflict: ${ignored.reason}`);
    }
  }
  const ebookId = plan.rows[0].mutation.ebookId;
  const ids = new Set(outcomes.map((item) => item.id));
  if (
    new Set(response.annotations.map((item) => item.id)).size !==
      response.annotations.length ||
    response.annotations.some(
      (item) =>
        item.ebookId !== ebookId ||
        !ids.has(item.id) ||
        compareAnnotationTimes(item.updatedAt, response.serverTime) > 0,
    )
  )
    throw new Error("Invalid annotation receipt rows");
  const deleting = new Set(deletes.map((item) => String(item.id)));
  if (
    response.applied.some(
      (id) =>
        !deleting.has(id) &&
        !response.annotations.some((item) => item.id === id),
    )
  )
    throw new Error("An applied annotation needs its authoritative server row");
  return {
    outcomes,
    updateBook(bookId: string, current: AnnotationBook) {
      if (bookId !== ebookId)
        throw new Error("Annotation receipt belongs to another book");
      const cached = new Map(
        current.annotations.map((value) => {
          const row = annotationRecordSchema.parse(value);
          return [row.id, row];
        }),
      );
      for (const id of deleting)
        if (
          response.applied.includes(id) ||
          response.ignored.some(
            (item) =>
              item.id === id &&
              ["deleted", "already-retired", "retired"].includes(item.reason),
          )
        )
          cached.delete(id);
      for (const row of response.annotations) {
        const previous = cached.get(row.id);
        if (
          !previous ||
          compareAnnotationTimes(row.updatedAt, previous.updatedAt) > 0
        )
          cached.set(row.id, row);
      }
      return {
        annotations: [...cached.values()].map((value) => json(value)),
        cursor: current.cursor,
      };
    },
  };
}
