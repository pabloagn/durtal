import { z } from "zod/v4";
import { QUEUE_SOURCES } from "@/lib/reading/constants";

/* Up Next (SLN-452): every queue action's input */

const note = z.string().trim().max(500, "A note is at most 500 characters");

export const addToQueueSchema = z
  .object({
    workId: z.uuid(),
    editionId: z.uuid().nullable().optional(),
    note: note.nullable().optional(),
    at: z.enum(["top", "bottom"]).optional(),
    from: z.literal("suggestion").optional(),
  })
  .strict();

export const addManyToQueueSchema = z.object({ workIds: z.array(z.uuid()).min(1).max(1000) }).strict();

export const queueWorkSchema = z.object({ workId: z.uuid() }).strict();

export const moveQueueItemSchema = z
  .object({
    workId: z.uuid(),
    /** The item it now comes before (below it); none at the bottom */
    beforeWorkId: z.uuid().nullable().optional(),
    /** The item it now comes after (above it); none at the top */
    afterWorkId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((m) => m.beforeWorkId !== m.workId && m.afterWorkId !== m.workId, "An item cannot move next to itself");

export const updateQueueItemSchema = z
  .object({ workId: z.uuid(), editionId: z.uuid().nullable().optional(), note: note.nullable().optional() })
  .strict();

/** A removed row, as removeFromQueue returned it, for its Undo */
export const queueSnapshotSchema = z.object({
  id: z.uuid(),
  workId: z.uuid(),
  editionId: z.uuid().nullable(),
  position: z.number().int(),
  note: z.string().max(500).nullable(),
  source: z.enum(QUEUE_SOURCES),
  importId: z.uuid().nullable(),
  sourceKey: z.string().nullable(),
  addedAt: z.coerce.date(),
});
export type QueueSnapshot = z.infer<typeof queueSnapshotSchema>;

export const getQueueSchema = z.object({ homeId: z.uuid().nullable().optional() }).optional();
