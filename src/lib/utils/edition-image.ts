/**
 * The one image rule for an edition: its own cover first, then the book's
 * active poster, then none. Pure module, usable on server and client.
 */
import { mediaCrop, type MediaCrop } from "@/lib/utils/media-style";

export interface EditionImageKeys {
  coverS3Key: string | null;
  thumbnailS3Key: string | null;
}

/** An active poster media row (crop and adjustments may be missing) */
export interface PosterImage {
  s3Key: string;
  thumbnailS3Key: string | null;
  cropX?: number | null;
  cropY?: number | null;
  cropZoom?: number | null;
  brightness?: number | null;
  contrast?: number | null;
}

export interface EditionImage {
  key: string;
  /** The poster's crop and adjustments; null for an edition cover */
  crop: Required<MediaCrop> | null;
  source: "edition" | "poster";
}

export function editionImage(
  edition: EditionImageKeys,
  poster?: PosterImage | null,
): EditionImage | null {
  const own = edition.thumbnailS3Key ?? edition.coverS3Key;
  if (own) return { key: own, crop: null, source: "edition" };
  const posterKey = poster?.thumbnailS3Key ?? poster?.s3Key;
  if (poster && posterKey)
    return { key: posterKey, crop: mediaCrop(poster), source: "poster" };
  return null;
}
