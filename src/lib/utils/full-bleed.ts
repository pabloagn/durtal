/**
 * Horizontal insets that stretch a layer from its host box to the edges of the
 * page frame (the app's `main` area). Pure: takes two measured rectangles.
 *
 * The result is never negative, so the layer can reach the frame edges but
 * never pass them (no horizontal scroll).
 */
export interface BleedInsets {
  left: number;
  right: number;
}

export const NO_BLEED: BleedInsets = { left: 0, right: 0 };

export function bleedInsets(
  host: { left: number; right: number },
  frame: { left: number; right: number },
): BleedInsets {
  return {
    left: Math.max(0, host.left - frame.left),
    right: Math.max(0, frame.right - host.right),
  };
}
