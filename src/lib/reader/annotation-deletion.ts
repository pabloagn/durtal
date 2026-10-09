import type {
  AnnotationColor,
  ReaderAnnotation,
  RetiredAnnotationId,
} from "./annotations";
import type { AnnotationDelete } from "@/lib/validations/annotations";
import { mergeAnnotation } from "./sync/annotation-merge";
import { canonicalAnnotationTime } from "./sync/annotation-time";

/** Opaque server-issued versions: never parse, trim or regenerate them. */
export type DeferredQuoteEffect =
  | { action: "none" }
  | {
      action: "keep-quote" | "delete-quote";
      noteId: string;
      expectedNoteVersion: string;
      expectedBindingVersion: string;
    };
export type PreparedAnnotationDelete =
  | { status: "cancel" }
  | { status: "proceed"; effect: DeferredQuoteEffect };

/** Prepare confirmation data only; this hook must not invoke a tracker writer.
 * Cancellation/abort creates no operation. Start Undo only after the coordinator
 * durably inserts the resulting mutation, effect and snapshot together.
 */
export interface AnnotationDeleteHook {
  prepare(
    annotation: Readonly<ReaderAnnotation>,
    signal: AbortSignal,
  ): Promise<PreparedAnnotationDelete>;
}

export function assertAnnotationDeleteEffect(
  annotation: ReaderAnnotation,
  effect: DeferredQuoteEffect,
) {
  if ((annotation.style === "quote") === (effect.action === "none"))
    throw new Error("Quote deletion needs an explicit prepared quote choice");
  if (
    effect.action !== "none" &&
    (!effect.noteId ||
      !effect.expectedNoteVersion ||
      !effect.expectedBindingVersion)
  )
    throw new Error("Quote deletion needs exact note and binding versions");
}

export function preparedAnnotationDelete(input: {
  annotation: ReaderAnnotation;
  prepared: PreparedAnnotationDelete;
  clientUpdatedAt: string;
  signal?: AbortSignal;
}): (AnnotationDelete & { op: "delete" }) | null {
  if (input.signal?.aborted || input.prepared.status === "cancel") return null;
  assertAnnotationDeleteEffect(input.annotation, input.prepared.effect);
  return {
    op: "delete",
    id: input.annotation.id,
    clientUpdatedAt: canonicalAnnotationTime(input.clientUpdatedAt),
    quoteEffect: { ...input.prepared.effect },
  };
}

/** Trusted facts loaded by the composed server transaction, never browser claims.
 * Binding versions cover the note/annotation/book association. Actual ownership,
 * version predicates and retirement guards must be rechecked under that lock.
 */
export interface ReadingQuoteBinding {
  noteId: string;
  annotationId: string;
  ebookId: string;
  noteVersion: string;
  bindingVersion: string;
}
export type AnnotationDeleteConflict =
  | "ownership"
  | "identity"
  | "missing"
  | "quote-choice"
  | "binding"
  | "note-version"
  | "binding-version";
export type ComposedAnnotationDeleteDecision =
  | {
      status: "apply";
      annotation: ReaderAnnotation | null;
      retired: RetiredAnnotationId;
      deleteReadingQuoteId: string | null;
    }
  | { status: "already-retired" }
  | { status: "conflict"; reason: AnnotationDeleteConflict };

function bindingConflict(
  ebookId: string,
  annotationId: string,
  effect: Exclude<DeferredQuoteEffect, { action: "none" }>,
  binding: ReadingQuoteBinding | null,
): AnnotationDeleteConflict | null {
  if (
    !binding ||
    binding.ebookId !== ebookId ||
    binding.annotationId !== annotationId ||
    binding.noteId !== effect.noteId
  )
    return "binding";
  if (binding.noteVersion !== effect.expectedNoteVersion) return "note-version";
  if (binding.bindingVersion !== effect.expectedBindingVersion)
    return "binding-version";
  return null;
}

/** A single all-or-nothing decision, not a server operation or authorization layer.
 * Replay after retirement never runs a delayed quote effect, including a replay
 * whose first completed delete explicitly kept its quote. The transport can
 * acknowledge already-retired, but must retain conflicts for resolution.
 */
export function planComposedAnnotationDelete(input: {
  ebookId: string;
  authorized: boolean;
  current: ReaderAnnotation | null;
  retired: RetiredAnnotationId | null;
  mutation: AnnotationDelete & { op: "delete" };
  binding: ReadingQuoteBinding | null;
  serverTime: string;
}): ComposedAnnotationDeleteDecision {
  const { current, retired, mutation, ebookId } = input;
  const conflict = (
    reason: AnnotationDeleteConflict,
  ): ComposedAnnotationDeleteDecision => ({ status: "conflict", reason });
  if (!input.authorized) return conflict("ownership");
  if (
    (current && (current.id !== mutation.id || current.ebookId !== ebookId)) ||
    (retired && (retired.id !== mutation.id || retired.ebookId !== ebookId))
  )
    return conflict("identity");
  if (retired || current?.deletedAt) return { status: "already-retired" };
  const effect = mutation.quoteEffect ?? { action: "none" };
  if ((current?.style === "quote") === (effect.action === "none"))
    return conflict("quote-choice");
  if (effect.action !== "none") {
    if (!current) return conflict("missing");
    const reason = bindingConflict(ebookId, current.id, effect, input.binding);
    if (reason) return conflict(reason);
  }
  const decision = mergeAnnotation({
    ebookId,
    current,
    retired,
    mutation,
    serverTime: input.serverTime,
    deviceId: current?.deviceId ?? null,
  });
  if (decision.action !== "apply" || !decision.retired)
    return conflict("identity");
  return {
    status: "apply",
    annotation: decision.annotation,
    retired: decision.retired,
    deleteReadingQuoteId:
      effect.action === "delete-quote" ? effect.noteId : null,
  };
}

/** Privileged tracker operation, deliberately absent from browser upsert schemas.
 * The caller atomically deletes the quote and applies this surviving annotation.
 * Only style, semantic colour and server update time change. Retirement is never
 * removed; a deleted mark is not recreated by tracker quote deletion.
 */
export function planTrackerQuoteDelete(input: {
  ebookId: string;
  authorized: boolean;
  current: ReaderAnnotation | null;
  retired: RetiredAnnotationId | null;
  binding: ReadingQuoteBinding | null;
  effect: Exclude<DeferredQuoteEffect, { action: "none" }> & {
    action: "delete-quote";
  };
  color: AnnotationColor;
  serverTime: string;
}):
  | {
      status: "apply";
      annotation: ReaderAnnotation;
      deleteReadingQuoteId: string;
    }
  | { status: "conflict"; reason: AnnotationDeleteConflict | "retired" } {
  const conflict = (reason: AnnotationDeleteConflict | "retired") => ({
    status: "conflict" as const,
    reason,
  });
  if (!input.authorized) return conflict("ownership");
  if (input.retired && input.retired.ebookId !== input.ebookId)
    return conflict("identity");
  if (!input.current) return conflict(input.retired ? "retired" : "missing");
  if (
    input.current.ebookId !== input.ebookId ||
    (input.retired &&
      (input.retired.ebookId !== input.ebookId ||
        input.retired.id !== input.current.id))
  )
    return conflict("identity");
  if (input.retired || input.current.deletedAt) return conflict("retired");
  if (input.current.style !== "quote") return conflict("quote-choice");
  const reason = bindingConflict(
    input.ebookId,
    input.current.id,
    input.effect,
    input.binding,
  );
  if (reason) return conflict(reason);
  return {
    status: "apply",
    deleteReadingQuoteId: input.effect.noteId,
    annotation: {
      ...input.current,
      style: "highlight",
      color: input.color,
      updatedAt: canonicalAnnotationTime(input.serverTime),
    },
  };
}
