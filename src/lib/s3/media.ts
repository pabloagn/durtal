import type { MonochromeParams } from "@/lib/validations/media";
import type { ImagePolicy } from "@/lib/media/policy";

/** The stored sizes of one image, ready to upload. */
export interface RenderedImage {
  full: Buffer;
  thumb: Buffer;
  /** Full-resolution copy for policies that keep the original; else null. */
  original: Buffer | null;
  width: number;
  height: number;
}

/** Longest side of a kept original; WebP cannot exceed 16383 px. */
const ORIGINAL_LIMIT = 12000;

/**
 * Render the display and thumbnail sizes for a policy. The aspect ratio is
 * always kept and images are never enlarged or cropped; EXIF orientation is
 * applied and metadata (including location) is dropped.
 */
export async function renderImage(
  buffer: Buffer,
  policy: ImagePolicy,
): Promise<RenderedImage> {
  const sharp = (await import("sharp")).default;
  const full = await sharp(buffer)
    .rotate()
    .resize(policy.maxWidth, policy.maxHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 90 })
    .toBuffer();
  const metadata = await sharp(full).metadata();
  const thumb = await sharp(buffer)
    .rotate()
    .resize(policy.thumbWidth, policy.thumbHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
  const original = policy.keepOriginal
    ? await sharp(buffer)
        .rotate()
        .resize(ORIGINAL_LIMIT, ORIGINAL_LIMIT, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 95 })
        .toBuffer()
    : null;
  return {
    full,
    thumb,
    original,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

// ── Author monochrome pipeline ──────────────────────────────────────────────

/**
 * Apply monochrome processing to an image buffer.
 * Pipeline order: grayscale → gamma → contrast → brightness → sharpen
 */
export async function applyMonochromeProcessing(
  buffer: Buffer,
  params: MonochromeParams,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  let pipeline = sharp(buffer).grayscale();

  if (params.gamma !== 2.2) {
    pipeline = pipeline.gamma(params.gamma);
  }

  if (params.contrast !== 1.0) {
    pipeline = pipeline.linear(params.contrast, -(128 * (params.contrast - 1)));
  }

  if (params.brightness !== 1.0) {
    pipeline = pipeline.modulate({ brightness: params.brightness });
  }

  if (params.sharpness > 0) {
    pipeline = pipeline.sharpen({ sigma: params.sharpness });
  }

  return pipeline.toBuffer();
}

/**
 * Render an author portrait: the colour original at display size is kept for
 * reprocessing, and the shown sizes are monochrome.
 */
export async function renderAuthorImage(
  buffer: Buffer,
  policy: ImagePolicy,
  params: MonochromeParams,
): Promise<RenderedImage> {
  const sharp = (await import("sharp")).default;
  const original = await sharp(buffer)
    .rotate()
    .resize(policy.maxWidth, policy.maxHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 90 })
    .toBuffer();
  const mono = await applyMonochromeProcessing(original, params);
  const full = await sharp(mono).webp({ quality: 90 }).toBuffer();
  const metadata = await sharp(full).metadata();
  const thumb = await sharp(mono)
    .resize(policy.thumbWidth, policy.thumbHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
  return {
    full,
    thumb,
    original,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}
