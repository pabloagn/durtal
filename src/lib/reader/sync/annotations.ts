import type { ReaderAnnotation } from "../annotations";
import { annotationPullSchema } from "@/lib/validations/annotations";
import { compareAnnotationTimes } from "./annotation-time";
import { mergeAnnotation } from "./annotation-merge";
import type { PendingAnnotation } from "./annotation-outbox";

/** Pure pull reconciliation. The IDB coordinator must commit rows and cursor
 * together, then publish display. POST serverTime is never a pull acknowledgment.
 * Full resets remove absent confirmed rows while preserving genuinely new
 * offline creates; missing known marks never become optimistic new creates.
 */
export function reconcileAnnotationPull(input: {
  ebookId: string;
  cached: readonly ReaderAnnotation[];
  cursor: string | null;
  pending: readonly PendingAnnotation[];
  response: unknown;
}): {
  cached: ReaderAnnotation[];
  display: ReaderAnnotation[];
  cursor: string;
  conflicts: { operationId: string; reason: string }[];
} {
  const pull = annotationPullSchema.parse(input.response);
  if (
    input.cursor !== null &&
    compareAnnotationTimes(pull.serverTime, input.cursor) < 0
  )
    throw new Error("An annotation pull cannot move the cursor backwards");
  const rows = new Map<string, ReaderAnnotation>();
  for (const item of input.cached) {
    if (item.ebookId !== input.ebookId)
      throw new Error("Cached annotation belongs to another e-book");
    if (!pull.reset) rows.set(item.id, item);
  }
  for (const item of pull.annotations) {
    if (item.ebookId !== input.ebookId)
      throw new Error("Annotation response belongs to another e-book");
    const current = rows.get(item.id);
    if (
      !current ||
      compareAnnotationTimes(item.updatedAt, current.updatedAt) > 0
    )
      rows.set(item.id, item);
  }
  const { display, conflicts } = overlayPendingAnnotations({
    ebookId: input.ebookId,
    cached: [...rows.values()],
    pending: input.pending,
  });
  return {
    cached: [...rows.values()],
    display,
    cursor: pull.serverTime,
    conflicts,
  };
}

/** Display only: confirmed rows/cursor remain separate from local intent.
 * Missing known rows cannot become new creates after a reset or retirement.
 * No synthetic pull response or cursor is needed to display offline edits.
 */
export function overlayPendingAnnotations(input: {
  ebookId: string;
  cached: readonly ReaderAnnotation[];
  pending: readonly PendingAnnotation[];
}): {
  display: ReaderAnnotation[];
  conflicts: { operationId: string; reason: string }[];
} {
  if (input.cached.some((item) => item.ebookId !== input.ebookId))
    throw new Error("Cached annotation belongs to another e-book");
  const rows = new Map(input.cached.map((item) => [item.id, item]));
  const display = new Map(rows);
  const pendingDeletes = new Set<string>();
  const conflicts: { operationId: string; reason: string }[] = [];
  // The shared store supplies durable insertion order. Sorting unrelated UUIDs
  // or per-operation revisions can put a note before its offline create.
  for (const row of input.pending) {
    if (row.ebookId !== input.ebookId)
      throw new Error("Pending annotation belongs to another e-book");
    const current = display.get(row.mutation.id) ?? null;
    if (row.mutation.op === "delete") {
      pendingDeletes.add(row.mutation.id);
      display.delete(row.mutation.id);
      continue;
    }
    if (pendingDeletes.has(row.mutation.id)) {
      conflicts.push({ operationId: row.operationId, reason: "deleted" });
      continue;
    }
    if (row.baseVersion !== null && !rows.has(row.mutation.id)) {
      conflicts.push({ operationId: row.operationId, reason: "deleted" });
      continue;
    }
    const localTime =
      row.mutation.op === "reanchor"
        ? row.mutation.expectedClientUpdatedAt
        : row.mutation.clientUpdatedAt;
    const decision = mergeAnnotation({
      ebookId: input.ebookId,
      current,
      retired: null,
      mutation: row.mutation,
      serverTime: localTime,
      deviceId: current?.deviceId ?? null,
    });
    if (decision.action === "apply" && decision.annotation)
      display.set(decision.annotation.id, decision.annotation);
    else if (
      decision.action === "ignore" &&
      decision.reason !== "equal" &&
      decision.reason !== "unchanged"
    )
      conflicts.push({ operationId: row.operationId, reason: decision.reason });
  }
  return {
    display: [...display.values()].filter((item) => !item.deletedAt),
    conflicts,
  };
}
