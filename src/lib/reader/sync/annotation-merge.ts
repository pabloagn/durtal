import type {
  AnnotationMutation,
  ReaderAnnotation,
  RetiredAnnotationId,
} from "../annotations";
import type { DurtalLocator } from "../engine";
import {
  canonicalAnnotationTime,
  compareAnnotationTimes,
} from "./annotation-time";

export type AnnotationIgnoreReason =
  | "older"
  | "equal"
  | "deleted"
  | "missing"
  | "wrong-ebook"
  | "wrong-id"
  | "quote-privilege"
  | "immutable-kind"
  | "immutable-text"
  | "bookmark-note"
  | "anchor-changed"
  | "unchanged";
export type AnnotationMergeDecision =
  | {
      action: "apply";
      annotation: ReaderAnnotation | null;
      retired: RetiredAnnotationId | null;
    }
  | { action: "ignore"; reason: AnnotationIgnoreReason };

/** DB callers must repeat these predicates in the coordinated atomic write. */
export function annotationFileMatches(
  ebookId: string,
  fileId: string,
  locator: DurtalLocator,
  file: { id: string; ebookId: string; sha256: string } | null,
) {
  return (
    !!file &&
    file.id === fileId &&
    file.ebookId === ebookId &&
    file.sha256 === locator.fileHash
  );
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

/** Pure reference policy. It performs no reads, writes, ownership lookup or locking. */
export function mergeAnnotation(input: {
  ebookId: string;
  current: ReaderAnnotation | null;
  retired: RetiredAnnotationId | null;
  mutation: AnnotationMutation;
  serverTime: string;
  deviceId: string | null;
}): AnnotationMergeDecision {
  const { ebookId, current, retired, mutation, deviceId } = input;
  const ignore = (reason: AnnotationIgnoreReason): AnnotationMergeDecision => ({
    action: "ignore",
    reason,
  });
  if (
    (current && current.id !== mutation.id) ||
    (retired && retired.id !== mutation.id)
  )
    return ignore("wrong-id");
  if (
    (current && current.ebookId !== ebookId) ||
    (retired && retired.ebookId !== ebookId)
  )
    return ignore("wrong-ebook");
  if (retired) return ignore("deleted");
  const serverTime = canonicalAnnotationTime(input.serverTime);
  if (mutation.op === "delete") {
    const retirement = {
      id: mutation.id,
      ebookId,
      retiredAt: current?.deletedAt ?? serverTime,
    };
    const at =
      current &&
      compareAnnotationTimes(
        current.clientUpdatedAt,
        mutation.clientUpdatedAt,
      ) > 0
        ? current.clientUpdatedAt
        : mutation.clientUpdatedAt;
    return {
      action: "apply",
      retired: retirement,
      annotation: current
        ? current.deletedAt
          ? current
          : {
              ...current,
              clientUpdatedAt: at,
              updatedAt: serverTime,
              deletedAt: serverTime,
            }
        : null,
    };
  }
  if (current?.deletedAt) return ignore("deleted");
  if (mutation.op === "reanchor") {
    if (!current) return ignore("missing");
    if (
      current.fileId !== mutation.expectedFileId ||
      compareAnnotationTimes(
        current.clientUpdatedAt,
        mutation.expectedClientUpdatedAt,
      ) !== 0
    )
      return ignore("anchor-changed");
    if (
      current.fileId === mutation.fileId &&
      current.anchorState === mutation.anchorState &&
      stable(current.locator) === stable(mutation.locator)
    )
      return ignore("unchanged");
    return {
      action: "apply",
      retired: null,
      annotation: {
        ...current,
        fileId: mutation.fileId,
        locator: mutation.locator,
        progression: mutation.locator.totalProgression,
        anchorState: mutation.anchorState,
        updatedAt: serverTime,
      },
    };
  }
  if (current) {
    if (mutation.op === "put" && current.style === "quote")
      return ignore("quote-privilege");
    if (mutation.op === "put" && current.kind !== mutation.kind)
      return ignore("immutable-kind");
    if (mutation.op === "put" && current.text !== mutation.text)
      return ignore("immutable-text");
    if (mutation.op === "note" && current.kind === "bookmark")
      return ignore("bookmark-note");
    const order = compareAnnotationTimes(
      mutation.clientUpdatedAt,
      current.clientUpdatedAt,
    );
    if (order <= 0) return ignore(order === 0 ? "equal" : "older");
  }
  if (mutation.op === "note") {
    if (!current) return ignore("missing");
    return {
      action: "apply",
      retired: null,
      annotation: {
        ...current,
        note: mutation.note,
        clientUpdatedAt: mutation.clientUpdatedAt,
        updatedAt: serverTime,
        deviceId,
      },
    };
  }
  const { op: _op, ...fields } = mutation;
  void _op;
  return {
    action: "apply",
    retired: null,
    annotation: {
      ...fields,
      ebookId,
      deviceId,
      fileId: current?.fileId ?? fields.fileId,
      locator: current?.locator ?? fields.locator,
      chapter: current ? current.chapter : fields.chapter,
      progression: current?.progression ?? fields.locator.totalProgression,
      anchorState: current?.anchorState ?? "exact",
      createdAt: current?.createdAt ?? serverTime,
      updatedAt: serverTime,
      deletedAt: null,
    },
  };
}
