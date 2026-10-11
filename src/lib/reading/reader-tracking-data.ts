import { z } from "zod/v4";

export const readerTrackingDataSchema = z.strictObject({
  version: z.literal(1),
  ebookId: z.uuid(),
  deviceId: z.uuid(),
  autoTrack: z.boolean(),
  dayStartHour: z.number().int().min(0).max(6),
  estimate: z.strictObject({ minutesPerPercent: z.number().nonnegative(), explanation: z.string() }).nullable(),
  linked: z.strictObject({
    workId: z.uuid(), title: z.string(), editionId: z.uuid(), instanceId: z.uuid(),
    hasClosedHistory: z.boolean(),
    reading: z.strictObject({
      id: z.uuid(), fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
      status: z.enum(["reading", "paused"]), unit: z.enum(["pages", "percent", "minutes"]),
      percent: z.number().min(0).max(100).nullable(), page: z.number().nullable(),
      totalPages: z.number().nullable(), chapter: z.string().nullable(),
    }).nullable(),
  }).nullable(),
});
export type ReaderTrackingData = z.infer<typeof readerTrackingDataSchema>;
