export const FIXED_ZOOM_PRESETS = [
  50, 75, 100, 125, 150, 200, 300, 400,
] as const;
export type FixedFit = "page" | "width";
export type FixedSpread = "auto" | "none" | "both";
export type FixedFormat = "pdf" | "cbz" | "epub";

export function fitZoomAttribute(fit: FixedFit): "fit-page" | "fit-width" {
  return fit === "width" ? "fit-width" : "fit-page";
}

export function toggleFixedFit(fit: FixedFit): FixedFit {
  return fit === "page" ? "width" : "page";
}

export function defaultFixedFit(
  deviceClass: "phone" | "tablet" | "desktop",
): FixedFit {
  return deviceClass === "phone" ? "width" : "page";
}

/** Pinch/wheel percentages are continuous; preset keys use the next stop. */
export function clampFixedZoom(percent: number): number {
  if (!Number.isFinite(percent))
    throw new RangeError("Invalid fixed-page zoom");
  return Math.min(400, Math.max(50, percent));
}

export function stepFixedZoom(percent: number, direction: 1 | -1): number {
  const current = clampFixedZoom(percent);
  return direction === 1
    ? (FIXED_ZOOM_PRESETS.find((preset) => preset > current) ?? 400)
    : ([...FIXED_ZOOM_PRESETS].reverse().find((preset) => preset < current) ??
        50);
}

/** PDF scale 1 uses points; printed size is 96 CSS px per 72 PDF points. */
export function fixedZoomScale(format: FixedFormat, percent: number): number {
  return (clampFixedZoom(percent) / 100) * (format === "pdf" ? 96 / 72 : 1);
}

export function fixedShortcut(
  key: string,
  currentPercent: number,
  fit: FixedFit,
): { zoom: number } | { fit: FixedFit } | null {
  if (key === "+" || key === "=")
    return { zoom: stepFixedZoom(currentPercent, 1) };
  if (key === "-") return { zoom: stepFixedZoom(currentPercent, -1) };
  if (key === "0") return { fit };
  if (key === "w") return { fit: toggleFixedFit(fit) };
  return null;
}

/** Author spread constraints apply only to Auto; explicit One/Two override. */
export function fixedSpreadMode(input: {
  preference: FixedSpread;
  areaWidth: number;
  areaHeight: number;
  pageWidth: number;
  pageHeight: number;
  renditionSpread?: "auto" | "none" | "landscape" | "portrait" | "both";
}): "none" | "both" {
  if (
    ![
      input.areaWidth,
      input.areaHeight,
      input.pageWidth,
      input.pageHeight,
    ].every((n) => Number.isFinite(n) && n > 0)
  )
    throw new RangeError("Invalid fixed-page dimensions");
  if (input.preference !== "auto") return input.preference;
  const landscape = input.areaWidth > input.areaHeight;
  const authorAllows =
    input.renditionSpread !== "none" && input.renditionSpread !== "portrait";
  return landscape &&
    input.areaWidth >= 1000 &&
    input.pageHeight > input.pageWidth &&
    authorAllows
    ? "both"
    : "none";
}
