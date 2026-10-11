/** Fixed-page raster policy. CSS/text geometry is independent of backing size. */
export const MAX_PAGE_PIXELS = 16 * 1024 * 1024;
export const MAX_CANVAS_BYTES = 128 * 1024 * 1024;
const BYTES_PER_PIXEL = 4;

export interface CanvasBudgetInput {
  pageCssWidth: number;
  pageCssHeight: number;
  devicePixelRatio: number;
  /** Include all live and reserved in-progress backing allocations. */
  otherCanvasBytes: number;
}

function validate(input: CanvasBudgetInput): void {
  if (
    !Number.isFinite(input.pageCssWidth) ||
    input.pageCssWidth <= 0 ||
    !Number.isFinite(input.pageCssHeight) ||
    input.pageCssHeight <= 0 ||
    !Number.isFinite(input.devicePixelRatio) ||
    input.devicePixelRatio <= 0 ||
    !Number.isSafeInteger(input.otherCanvasBytes) ||
    input.otherCanvasBytes < 0
  )
    throw new RangeError("Invalid canvas budget input");
}

/** Nominal DPR retains its floor; rasterPlan separately handles oversized CSS. */
export function renderDpr(input: CanvasBudgetInput): number {
  validate(input);
  const availablePixels = Math.max(
    0,
    Math.min(
      MAX_PAGE_PIXELS,
      Math.floor((MAX_CANVAS_BYTES - input.otherCanvasBytes) / BYTES_PER_PIXEL),
    ),
  );
  const area = input.pageCssWidth * input.pageCssHeight;
  return Math.max(
    1,
    Math.min(input.devicePixelRatio, 2, Math.sqrt(availablePixels / area)),
  );
}

export interface RasterPlan {
  dpr: number;
  width: number;
  height: number;
  bytes: number;
  /** Actual backing-pixel/CSS-pixel ratios, including integer rounding. */
  scaleX: number;
  scaleY: number;
}

/** Null means defer/evict, never allocate past the remaining shared budget. */
export function rasterPlan(input: CanvasBudgetInput): RasterPlan | null {
  const dpr = renderDpr(input);
  const pixels = Math.min(
    MAX_PAGE_PIXELS,
    Math.floor((MAX_CANVAS_BYTES - input.otherCanvasBytes) / BYTES_PER_PIXEL),
  );
  if (pixels < 1) return null;
  // Dividing successively avoids overflow for otherwise finite CSS dimensions.
  const scale = Math.min(
    dpr,
    Math.sqrt(pixels / input.pageCssWidth / input.pageCssHeight),
  );
  const width = Math.max(1, Math.floor(input.pageCssWidth * scale));
  const height = Math.max(1, Math.floor(input.pageCssHeight * scale));
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width * height > pixels
  )
    return null;
  return {
    dpr,
    width,
    height,
    bytes: width * height * BYTES_PER_PIXEL,
    scaleX: width / input.pageCssWidth,
    scaleY: height / input.pageCssHeight,
  };
}

export function fixedCanvasLimits(twoPages: boolean): {
  pageCanvases: number;
  cachedSpreads: number;
} {
  return twoPages
    ? { pageCanvases: 4, cachedSpreads: 1 }
    : { pageCanvases: 3, cachedSpreads: 2 };
}
