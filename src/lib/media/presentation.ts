import { s3ImageSource } from "@/lib/utils/image-adjustments";
import type { ImagePolicy, ImageSlot } from "./policy";

/** The stored facts a frame needs about one image. */
export interface PresentableImage {
  s3Key: string;
  thumbnailS3Key: string | null;
  width: number | null;
  height: number | null;
  cropX: number;
  cropY: number;
  cropZoom: number;
  altText: string | null;
}

export interface ImagePresentation {
  /** Image URL, or null when there is no image (show a placeholder). */
  src: string | null;
  /** Frame width divided by frame height. */
  aspectRatio: number;
  objectFit: "cover" | "contain";
  objectPosition: string;
  /** Zoom for a focal-point crop; 1 for contained images. */
  scale: number;
  alt: string;
  /** The image's own shape, when known. */
  orientation: "portrait" | "landscape" | "square" | null;
}

const SLOT_RATIO: Record<Exclude<ImageSlot, "native">, number> = {
  portrait: 2 / 3,
  landscape: 16 / 9,
  square: 1,
};
/** Native frames follow the image, within bounds that keep a grid readable. */
export const NATIVE_RATIO_LIMITS = { min: 1 / 2.5, max: 2.5 } as const;
/** A missing native image keeps a typical canvas shape. */
const NATIVE_FALLBACK = 4 / 5;

function orientationOf(width: number | null, height: number | null) {
  if (!width || !height) return null;
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= 0.02) return "square" as const;
  return ratio > 1 ? ("landscape" as const) : ("portrait" as const);
}

/**
 * How one image fills its frame. Portrait and landscape frames crop to the
 * stored focal point; square and native frames contain the whole image and
 * ignore any crop, so artworks and product images are never cut. A landscape
 * image in a portrait frame is contained only when the policy says so.
 */
export function imagePresentation(
  policy: ImagePolicy,
  image: PresentableImage | null,
  fallbackAlt: string,
  size: "thumbnail" | "full" = "thumbnail",
): ImagePresentation {
  const orientation = image ? orientationOf(image.width, image.height) : null;
  const aspectRatio =
    policy.slot === "native"
      ? image?.width && image.height
        ? Math.min(
            NATIVE_RATIO_LIMITS.max,
            Math.max(NATIVE_RATIO_LIMITS.min, image.width / image.height),
          )
        : NATIVE_FALLBACK
      : SLOT_RATIO[policy.slot];
  const cover = policy.fit === "cover" && !!image;
  return {
    src: image
      ? s3ImageSource(
          size === "thumbnail" && image.thumbnailS3Key
            ? image.thumbnailS3Key
            : image.s3Key,
        )
      : null,
    aspectRatio,
    objectFit: policy.fit,
    objectPosition: cover ? `${image.cropX}% ${image.cropY}%` : "50% 50%",
    scale: cover ? image.cropZoom / 100 : 1,
    alt: image?.altText ?? fallbackAlt,
    orientation,
  };
}
