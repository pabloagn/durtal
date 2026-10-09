import type { DeviceClass } from "@/lib/validations/reader-preferences";

/** Call on open; resize changes layout, never the session's preference class. */
export function deviceClass({
  width,
  height,
  coarse,
}: {
  width: number;
  height: number;
  coarse: boolean;
}): DeviceClass {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    throw new RangeError("The viewport must have a positive width and height");
  const shortSide = Math.min(width, height);
  if (shortSide < 600) return "phone";
  if (shortSide < 1100 || coarse) return "tablet";
  return "desktop";
}
