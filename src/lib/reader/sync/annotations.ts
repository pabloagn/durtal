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
  const display = new Map(rows);
  const pendingDeletes = new Set<string>();
  const conflicts: { operationId: string; reason: string }[] = [];
  for (const row of [...input.pending].sort(
    (a, b) =>
      a.revision - b.revision || a.operationId.localeCompare(b.operationId),
  )) {
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
    if (pull.reset && row.baseVersion !== null && !rows.has(row.mutation.id)) {
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
    cached: [...rows.values()],
    display: [...display.values()].filter((item) => !item.deletedAt),
    cursor: pull.serverTime,
    conflicts,
  };
}
