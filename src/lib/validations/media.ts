import { z } from "zod";

export const createMediaSchema = z
  .object({
    workId: z.string().uuid().optional(),
    authorId: z.string().uuid().optional(),
    type: z.enum(["poster", "background", "gallery"]),
    s3Key: z.string().min(1),
    thumbnailS3Key: z.string().optional(),
    originalFilename: z.string().optional(),
    mimeType: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    sizeBytes: z.number().int().positive().optional(),
    sortOrder: z.number().int().optional().default(0),
    caption: z.string().optional(),
  })
  .refine(
    (d) => (d.workId != null) !== (d.authorId != null),
    { message: "Exactly one of workId or authorId must be set" },
  );

export const updateMediaSchema = z.object({
  sortOrder: z.number().int().optional(),
  caption: z.string().optional(),
});

export type CreateMediaInput = z.input<typeof createMediaSchema>;
export type UpdateMediaInput = z.input<typeof updateMediaSchema>;
