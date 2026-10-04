import { z } from "zod";
import {
  imageAdjustmentRule,
  type ImageAdjustments,
  type StoredImageAdjustments,
} from "./image-adjustment-css";

export {
  DEFAULT_IMAGE_ADJUSTMENTS,
  enforceImagePolicy,
  imageAdjustmentFilter,
  imageSourceIdentity,
  s3ImageSource,
  type ImageAdjustments,
  type StoredImageAdjustments,
} from "./image-adjustment-css";

export const imageAdjustmentsSchema = z
  .object({
    exposure: z.number().min(-2).max(2).default(0),
    brightness: z.number().min(0).max(200).default(100),
    contrast: z.number().min(0).max(200).default(100),
    saturation: z.number().min(0).max(200).default(100),
    grayscale: z.number().min(0).max(100).default(0),
    sepia: z.number().min(0).max(100).default(0),
    softness: z.number().min(0).max(8).default(0),
  })
  .strict() satisfies z.ZodType<ImageAdjustments>;

/** Rules exist only for explicitly edited assets; an empty table changes no images. */
export function imageAdjustmentStyles(rows: StoredImageAdjustments[]): string {
  return rows
    .map((row) => {
      const parsed = imageAdjustmentsSchema.safeParse(row.settings);
      if (!parsed.success) return "";
      return imageAdjustmentRule({ ...row, settings: parsed.data });
    })
    .join("\n");
}
