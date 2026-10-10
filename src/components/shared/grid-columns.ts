/** Desktop requested density is an upper bound. Phone Large/Compact is a CSS
 * projection of the same value, leaving the saved preference unchanged.
 * Desktop cards get at least 208px, or the whole available width in a
 * smaller container. All thresholds include gaps. */
export const COL_CLASSES: Record<number, string> = {
  2: "catalogue-density-grid catalogue-density-large grid-cols-1 @[432px]:grid-cols-2",
  3: "catalogue-density-grid catalogue-density-compact grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3",
  4: "catalogue-density-grid catalogue-density-compact grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3 @[880px]:grid-cols-4",
  5: "catalogue-density-grid catalogue-density-compact grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3 @[880px]:grid-cols-4 @[1104px]:grid-cols-5",
  6: "catalogue-density-grid catalogue-density-compact grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3 @[880px]:grid-cols-4 @[1104px]:grid-cols-5 @[1328px]:grid-cols-6",
  7: "catalogue-density-grid catalogue-density-compact grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3 @[880px]:grid-cols-4 @[1104px]:grid-cols-5 @[1328px]:grid-cols-6 @[1552px]:grid-cols-7",
  8: "catalogue-density-grid catalogue-density-compact grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3 @[880px]:grid-cols-4 @[1104px]:grid-cols-5 @[1328px]:grid-cols-6 @[1552px]:grid-cols-7 @[1776px]:grid-cols-8",
};

/** Container width (px) where each count in `COL_CLASSES` starts */
const COUNT_STARTS: Record<number, number> = {
  2: 432, 3: 656, 4: 880, 5: 1104, 6: 1328, 7: 1552, 8: 1776,
};
/** Widest page content: the shell's max-w-6xl minus its px-6 */
const CONTENT_MAX_PX = 1104;
const GAP_PX = 16;
/** Coarse phone Large can occupy the full viewport below the CSS md boundary. */
const PHONE_MAX_PX = 767;

/**
 * Conservative image-size bound (CSS px) at a slider value. Desktop counts
 * peak before the next threshold; phone Large may fill its whole viewport.
 */
export function maxCardWidth(columns: number): number {
  let max = columns === 2 ? PHONE_MAX_PX : 0;
  for (let n = 1; n <= columns; n++) {
    if (n > 1 && COUNT_STARTS[n] > CONTENT_MAX_PX) break;
    const end = n === columns ? CONTENT_MAX_PX : Math.min(CONTENT_MAX_PX, COUNT_STARTS[n + 1]);
    max = Math.max(max, (end - GAP_PX * (n - 1)) / n);
  }
  return Math.ceil(max);
}
