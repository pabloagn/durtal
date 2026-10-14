import type { ReaderSessionSnapshot } from "../validations/reader-tracking";
import { SITTING_MERGE_MS } from "./active-time";

export interface SittingReceipt {
  sittingId: string;
  /** Original identity survives session/reading deletion and catalogue changes. */
  readingId: string;
  ebookId: string;
  deviceId: string;
  /** Audit identity remains available after the FK is cleared or compensated. */
  originalSessionId: string;
  sessionId: string | null;
  revision: number;
  startedAt: Date;
  endedAt: Date;
  activeSeconds: number;
  startPercent: number;
  endPercent: number;
  endChapter: string | null;
  goingBack: boolean;
  timeZone: string;
  retired: boolean;
}

export type ReceiptDecision =
  | { kind: "insert"; addedSeconds: number }
  | { kind: "update"; addedSeconds: number }
  | { kind: "ignore"; reason: "replayed" | "retired" }
  | { kind: "refuse"; reason: "identity_changed" | "revision_reused" | "clock_regressed" };

/** Policy only. The service must check and persist its result under one atomic lock. */
export function decideSittingReceipt(
  receipt: SittingReceipt | null,
  input: ReaderSessionSnapshot,
  owner: { ebookId: string; deviceId: string },
): ReceiptDecision {
  if (!receipt) return { kind: "insert", addedSeconds: input.activeSeconds };
  if (receipt.sittingId !== input.sittingId || receipt.readingId !== input.readingId ||
    receipt.ebookId !== owner.ebookId || receipt.deviceId !== owner.deviceId ||
    receipt.startedAt.getTime() !== input.startedAt.getTime() || receipt.startPercent !== input.startPercent ||
    receipt.timeZone !== input.timeZone || receipt.goingBack !== (input.goingBack === "went_back"))
    return { kind: "refuse", reason: "identity_changed" };
  if (receipt.retired || receipt.sessionId === null) return { kind: "ignore", reason: "retired" };
  if (input.revision < receipt.revision) return { kind: "ignore", reason: "replayed" };
  if (input.revision === receipt.revision) {
    const same = input.activeSeconds === receipt.activeSeconds && input.endPercent === receipt.endPercent &&
      input.endedAt.getTime() === receipt.endedAt.getTime() && input.endChapter === receipt.endChapter;
    return same ? { kind: "ignore", reason: "replayed" } : { kind: "refuse", reason: "revision_reused" };
  }
  if (input.activeSeconds < receipt.activeSeconds || input.endedAt < receipt.endedAt)
    return { kind: "refuse", reason: "clock_regressed" };
  return { kind: "update", addedSeconds: input.activeSeconds - receipt.activeSeconds };
}

export interface ReaderMergeCandidate {
  readingId: string;
  sessionId: string;
  source: string;
  endedAt: Date | null;
  format: string;
  editionId: string | null;
  durationSeconds: number | null;
  /** Where the session ended: a sitting that starts elsewhere jumped, and stays apart */
  endPercent?: number | null;
  retired: boolean;
  edited: boolean;
}

/** Different editions/formats and explicit backwards segments keep separate sessions. */
export function canMergeReaderSitting(
  previous: ReaderMergeCandidate,
  input: ReaderSessionSnapshot,
  editionId: string | null,
): boolean {
  if (previous.source !== "reader" || previous.retired || previous.edited || !previous.endedAt ||
    previous.readingId !== input.readingId || previous.format !== "ebook" || previous.editionId !== editionId ||
    input.goingBack === "went_back") return false;
  if (previous.endPercent != null && Math.abs(input.startPercent - previous.endPercent) > 1e-6) return false;
  const gap = input.startedAt.getTime() - previous.endedAt.getTime();
  return gap >= 0 && gap < SITTING_MERGE_MS &&
    (previous.durationSeconds ?? 0) + input.activeSeconds <= 86_400;
}

/** User edits/deletions retire all receipts of the affected canonical session before it changes. */
export function retireSittingReceipt(receipt: SittingReceipt): SittingReceipt {
  return { ...receipt, sessionId: null, retired: true };
}
