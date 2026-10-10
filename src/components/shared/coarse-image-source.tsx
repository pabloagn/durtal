import { imageSourceIdentity } from "@/lib/utils/image-adjustment-css";
import { withMediaWidth } from "@/lib/s3/media-url";

/** Native selection happens before the image request; src keeps its canonical
 * adjustment identity. External images never receive app-specific parameters. */
export function CoarseImageSource({ src }: { src: string }) {
  if (!imageSourceIdentity(src)) return null;
  return <source media="(pointer: coarse)" srcSet={withMediaWidth(src, 800)} />;
}
