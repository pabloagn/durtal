import {
  validateMutation,
  type ReaderMutation,
} from "@/lib/reader/offline/mutations";
import type { OutboxRow } from "@/lib/reader/offline/outbox-policy";
export const EBOOK = "8d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11";
export const FILE = "8d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a12";
export const DEVICE = "8d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a13";
export const OTHER = "8d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a14";
export const HASH = "a".repeat(64);
export const NOW = 1_800_000_000_000;
export const at = (seq: number) => new Date(NOW + seq).toISOString();
export const itemId = (seq: number) =>
  `8d2b2c8e-1f0a-4f6e-9a51-${seq.toString(16).padStart(12, "0")}`;
export function position(
  seq: number,
  progression: number,
  options: {
    time?: string;
    deviceId?: string;
    fileId?: string;
    ebookId?: string;
  } = {},
): OutboxRow {
  const fileId = options.fileId ?? FILE;
  return row(
    seq,
    validateMutation(
      {
        v: 1,
        operationId: `position-${seq}`,
        revision: 1,
        ebookId: options.ebookId ?? EBOOK,
        fileId,
        deviceId: options.deviceId ?? DEVICE,
        createdAt: at(seq),
        kind: "position",
        body: {
          fileId,
          locator: {
            v: 1,
            fileHash: HASH,
            href: "chapter.xhtml",
            sectionIndex: 0,
            progression,
            totalProgression: progression,
          },
          chapter: "Chapter 1",
          clientUpdatedAt: options.time ?? at(seq),
        },
      },
      { nowMs: NOW + 1000 },
    ),
  );
}
export function annotations(
  seq: number,
  options: {
    count?: number;
    sameId?: number;
    note?: string;
    batchable?: boolean;
    deleting?: boolean;
    deviceId?: string;
  } = {},
): OutboxRow {
  const items = Array.from({ length: options.count ?? 1 }, (_, index) => ({
    id: itemId(options.sameId ?? seq * 1000 + index),
    clientUpdatedAt: at(seq),
    note: options.note ?? "A note",
  }));
  return row(
    seq,
    validateMutation(
      {
        v: 1,
        operationId: `annotations-${seq}`,
        revision: 1,
        ebookId: EBOOK,
        fileId: FILE,
        deviceId: options.deviceId ?? DEVICE,
        createdAt: at(seq),
        kind: "annotations",
        batchable: options.batchable ?? true,
        body: {
          upserts: options.deleting ? [] : items,
          deletes: options.deleting ? items : [],
        },
      },
      { nowMs: NOW + 1000, annotations: () => true },
    ),
  );
}
export function row(seq: number, mutation: ReaderMutation): OutboxRow {
  return { seq, mutation, attempts: 0, state: "waiting", claim: null };
}
