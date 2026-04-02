import { z } from "zod";

// ── Author monochrome processing params ─────────────────────────────────────

export const monochromeParamsSchema = z.object({
  grayscale: z.literal(true).default(true),
  contrast: z.number().min(0.5).max(3.0).default(1.0),
  sharpness: z.number().min(0.0).max(5.0).default(1.0),
  gamma: z.number().min(0.5).max(3.0).default(2.2),
  brightness: z.number().min(0.5).max(2.0).default(1.0),
});

export type MonochromeParams = z.infer<typeof monochromeParamsSchema>;

export const DEFAULT_MONOCHROME_PARAMS: MonochromeParams = {
  grayscale: true,
  contrast: 1.0,
  sharpness: 1.0,
  gamma: 2.2,
  brightness: 1.0,
};

export function parseProcessingParams(raw: unknown): MonochromeParams | null {
  if (!raw) return null;
  const result = monochromeParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// ── Media CRUD schemas ──────────────────────────────────────────────────────

export const createMediaSchema = z
  .object({
    workId: z.string().uuid().optional(),
    authorId: z.string().uuid().optional(),
    type: z.enum(["poster", "background", "gallery"]),
    s3Key: z.string().min(1),
    thumbnailS3Key: z.string().optional(),
    originalS3Key: z.string().optional(),
    originalFilename: z.string().optional(),
    mimeType: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    sizeBytes: z.number().int().positive().optional(),
    sortOrder: z.number().int().optional().default(0),
    isActive: z.boolean().optional().default(true),
    caption: z.string().optional(),
    processingParams: monochromeParamsSchema.optional(),
    colorPalette: z.any().optional(),
  })
  .refine(
    (d) => (d.workId != null) !== (d.authorId != null),
    { message: "Exactly one of workId or authorId must be set" },
  );

export const updateMediaSchema = z.object({
  sortOrder: z.number().int().optional(),
  caption: z.string().optional(),
  processingParams: monochromeParamsSchema.optional(),
});

export const updateMediaCropSchema = z.object({
  cropX: z.number().min(0).max(100),
  cropY: z.number().min(0).max(100),
  cropZoom: z.number().min(100).max(300),
});

export type CreateMediaInput = z.input<typeof createMediaSchema>;
export type UpdateMediaInput = z.input<typeof updateMediaSchema>;
export type UpdateMediaCropInput = z.input<typeof updateMediaCropSchema>;
