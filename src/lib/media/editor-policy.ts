import type { ImagePolicy } from "./policy";
import { mediaFrameAspect } from "./crop";
import { imagePresentation, type PresentableImage } from "./presentation";

/** Crop permission follows the real owner's policy, never a caller-supplied flag. */
export function imageEditorPolicy(
  policy: ImagePolicy,
  type: string,
  image: PresentableImage,
) {
  const supportsCrop =
    policy.fit === "cover" && mediaFrameAspect(type) !== null;
  const presentation = imagePresentation(policy, image, "", "full");
  return { supportsCrop, aspect: presentation.aspectRatio, fit: policy.fit };
}
