import type { ReaderAnnotation } from "../annotations";
import type { PendingAnnotation } from "./annotation-outbox";
import { annotationOperationBody } from "./annotation-outbox";

/** The original per-item identity accompanies mixed-file batches. No replay may
 * stamp a new device, file, revision, client time or payload onto an old item.
 */
export interface DurableAnnotationOperation {
  kind: "annotation";
  operationId: string;
  revision: number;
  ebookId: string;
  fileId: string;
  expectedDeviceId: string;
  body: string;
  /** Local-only data committed with the queue entry; never part of HTTP JSON.
   * Existing entries cannot reset their seal or deadline on duplicate enqueue.
   */
  deleteUndo: {
    state: "undoable" | "sealed";
    until: number | null;
    snapshot: ReaderAnnotation;
  } | null;
}
export interface AnnotationBookState {
  annotations: readonly ReaderAnnotation[];
  cursor: string | null;
  /** A view of the common queue, never an independent pending-annotations store. */
  pending: readonly PendingAnnotation[];
}

/** Supplied by SLN-507's versioned five-store durtal-offline database.
 * Online and offline writes use this same queue. enqueue resolves only after a
 * durable shared commit. Claims/coalescing/navigator.locks/replay/exact revision
 * acknowledgments belong to that one owner. Auth/device mismatch is durably
 * blocked, not discarded. GET device preflight uses a no-store cookie-only
 * endpoint; replay sends the captured expected-device header, compared before
 * DB work. Legacy import needs an exact decoder and stable operation identity;
 * remove legacy revisions only after the shared commit, preserving unknowns.
 */
export interface AnnotationTransport {
  enqueue(operation: Readonly<DurableAnnotationOperation>): Promise<void>;
  readBook(ebookId: string): Promise<AnnotationBookState>;
  transactBook(
    ebookId: string,
    reduce: (current: AnnotationBookState) => AnnotationBookState,
  ): Promise<AnnotationBookState>;
  requestReplay(mode: "foreground" | "lifecycle"): Promise<void>;
  subscribe(ebookId: string, listener: () => void): () => void;
}

/** Capture a complete logical body before enqueue. This is only a serializer:
 * it neither claims nor persists nor replays. Deferred deletes remain undoable
 * in the shared queue until its owner atomically seals and claims them.
 */
export function serializeAnnotationOperation(
  row: PendingAnnotation,
  context: { fileId: string; expectedDeviceId: string },
): DurableAnnotationOperation {
  if (!context.fileId || !context.expectedDeviceId)
    throw new Error("Missing original annotation transport identity");
  const mutationFile =
    row.mutation.op === "put" || row.mutation.op === "reanchor"
      ? row.mutation.fileId
      : row.snapshot?.fileId;
  if (mutationFile && mutationFile !== context.fileId)
    throw new Error("Annotation transport file identity mismatch");
  if (row.mutation.op === "delete" && !row.snapshot)
    throw new Error("Missing durable annotation Undo snapshot");
  return {
    kind: "annotation",
    operationId: row.operationId,
    revision: row.revision,
    ebookId: row.ebookId,
    fileId: context.fileId,
    expectedDeviceId: context.expectedDeviceId,
    body: JSON.stringify(annotationOperationBody(row)),
    deleteUndo:
      row.mutation.op === "delete"
        ? {
            state: row.stage === "undoable" ? "undoable" : "sealed",
            until: row.undoUntil,
            snapshot: row.snapshot!,
          }
        : null,
  };
}
