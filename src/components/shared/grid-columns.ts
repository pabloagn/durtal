/** Requested density is an upper bound. Cards get at least 208px, or the
 * whole available width in a smaller container. All thresholds include gaps. */
export const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-1 @[432px]:grid-cols-2",
  3: "grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3",
  4: "grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3 @[880px]:grid-cols-4",
  5: "grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3 @[880px]:grid-cols-4 @[1104px]:grid-cols-5",
  6: "grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3 @[880px]:grid-cols-4 @[1104px]:grid-cols-5 @[1328px]:grid-cols-6",
  7: "grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3 @[880px]:grid-cols-4 @[1104px]:grid-cols-5 @[1328px]:grid-cols-6 @[1552px]:grid-cols-7",
  8: "grid-cols-1 @[432px]:grid-cols-2 @[656px]:grid-cols-3 @[880px]:grid-cols-4 @[1104px]:grid-cols-5 @[1328px]:grid-cols-6 @[1552px]:grid-cols-7 @[1776px]:grid-cols-8",
};

/** Container width (px) where each count in `COL_CLASSES` starts */
const COUNT_STARTS: Record<number, number> = {
  2: 432, 3: 656, 4: 880, 5: 1104, 6: 1328, 7: 1552, 8: 1776,
};
/** Widest page content: the shell's max-w-6xl minus its px-6 */
const CONTENT_MAX_PX = 1104;
const GAP_PX = 16;

/**
 * The widest a card gets (CSS px) at a slider value, over every container
 * width: each count is widest just before the next count starts.
 */
export function maxCardWidth(columns: number): number {
  let max = 0;
  for (let n = 1; n <= columns; n++) {
    if (n > 1 && COUNT_STARTS[n] > CONTENT_MAX_PX) break;
    const end = n === columns ? CONTENT_MAX_PX : Math.min(CONTENT_MAX_PX, COUNT_STARTS[n + 1]);
    max = Math.max(max, (end - GAP_PX * (n - 1)) / n);
  }
  return Math.ceil(max);
}
