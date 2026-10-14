import type { DeviceClass } from "@/lib/validations/reader-preferences";

/**
 * The device, from its screen and its pointer, never the window: a laptop is a
 * desktop at any window size, a touch screen is a tablet unless it is phone
 * sized (SLN-686). Call on open; resize changes layout, never the class.
 */
export function deviceClass({
  width,
  height,
  coarse,
}: {
  /** The screen's size in CSS pixels */
  width: number;
  height: number;
  /** The primary pointer is touch */
  coarse: boolean;
}): DeviceClass {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    throw new RangeError("The screen must have a positive width and height");
  const shortSide = Math.min(width, height);
  if (shortSide < 600) return "phone";
  return coarse ? "tablet" : "desktop";
}
