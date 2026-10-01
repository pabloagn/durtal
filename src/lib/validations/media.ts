import { z } from "zod";
import { sourceUrlSchema } from "@/lib/catalogue/provenance";

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

/**
 * What an image shows and whose it is. Alt text is read to people who cannot
 * see the image; credit, license and source attribute it. All optional.
 */
export const mediaAttributionSchema = z.strictObject({
  altText: z.string().trim().min(1).max(1000).nullable().optional(),
  credit: z.string().trim().min(1).max(500).nullable().optional(),
  license: z.string().trim().min(1).max(200).nullable().optional(),
  licenseUrl: sourceUrlSchema.nullable().optional(),
  sourceUrl: sourceUrlSchema.nullable().optional(),
  sourceRecordId: z.uuid().nullable().optional(),
});
export type MediaAttribution = z.input<typeof mediaAttributionSchema>;

export const createMediaSchema = z
  .object({
    workId: z.string().uuid().optional(),
    authorId: z.string().uuid().optional(),
    collectionId: z.string().uuid().optional(),
    organizationId: z.uuid().optional(),
    artObjectId: z.uuid().optional(),
    perfumeVariantId: z.uuid().optional(),
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
    ...mediaAttributionSchema.shape,
  })
  .refine(
    (d) =>
      [
        d.workId,
        d.authorId,
        d.collectionId,
        d.organizationId,
        d.artObjectId,
        d.perfumeVariantId,
      ].filter((id) => id != null).length === 1,
    { message: "An image belongs to exactly one record" },
  )
  .refine((d) => !(d.collectionId && d.type === "gallery"), {
    message: "Collections have poster and background images only",
  });

export const updateMediaSchema = z.object({
  sortOrder: z.number().int().optional(),
  caption: z.string().optional(),
  processingParams: monochromeParamsSchema.optional(),
});

export const updateMediaCropSchema = z.object({
  cropX: z.number().min(0).max(100),
  cropY: z.number().min(0).max(100),
  cropZoom: z.number().min(100).max(300),
  // Display adjustments in percent (100 = unchanged); CSS filter at render time
  brightness: z.number().min(0).max(200).optional(),
  contrast: z.number().min(0).max(200).optional(),
});

export type CreateMediaInput = z.input<typeof createMediaSchema>;
export type UpdateMediaInput = z.input<typeof updateMediaSchema>;
export type UpdateMediaCropInput = z.input<typeof updateMediaCropSchema>;
