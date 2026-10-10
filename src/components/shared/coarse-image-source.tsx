import { imageSourceIdentity } from "@/lib/utils/image-adjustment-css";
import { withMediaWidth } from "@/lib/s3/media-url";

/** Native selection happens before the image request; src keeps its canonical
 * adjustment identity. External images never receive app-specific parameters. */
export function CoarseImageSource({ src }: { src: string }) {
  if (!imageSourceIdentity(src)) return null;
  return <source media="(pointer: coarse)" srcSet={withMediaWidth(src, 800)} />;
}

// The img fallback itself is bounded: React may set src before assembling the
// picture during client navigation. The fine-pointer source keeps desktop art.
export function coarseImageFallback(src: string) {
  return imageSourceIdentity(src) ? withMediaWidth(src, 800) : src;
}
