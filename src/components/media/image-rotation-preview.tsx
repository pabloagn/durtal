"use client";

import { sameCrop, type AppliedCrop } from "@/lib/media/crop";
import { rotationPreviewSource } from "@/lib/media/rotation";
import {
  ImageRotationFrame,
  type ImageRotationFrameProps,
} from "./image-rotation-frame";

/** Preview geometry adapter; the shared editor supplies its existing zero node. */
export function ImageRotationPreview({
  sources,
  crop,
  baselineCrop,
  ...frame
}: Omit<ImageRotationFrameProps, "src" | "pendingCrop"> & {
  sources: { display: string; preview: string };
  crop: AppliedCrop | null;
  baselineCrop: AppliedCrop | null;
}) {
  const changed = !sameCrop(crop, baselineCrop);
  return (
    <ImageRotationFrame
      {...frame}
      src={rotationPreviewSource(sources, changed)}
      pendingCrop={changed ? crop : null}
    />
  );
}
