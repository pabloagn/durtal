/**
 * Cards per row from the size slider, inside an `@container`. A narrow page
 * holds fewer, so a card stays about 115px wide or more and its title stays
 * whole: each count starts where its cards reach that width.
 */
export const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 @sm:grid-cols-3",
  4: "grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4",
  5: "grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 @2xl:grid-cols-5",
  6: "grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 @2xl:grid-cols-5 @3xl:grid-cols-6",
  7: "grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 @2xl:grid-cols-5 @3xl:grid-cols-6 @4xl:grid-cols-7",
  8: "grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 @2xl:grid-cols-5 @3xl:grid-cols-6 @4xl:grid-cols-7 @5xl:grid-cols-8",
};

/** Container width (px) where each count in `COL_CLASSES` starts */
const COUNT_STARTS: Record<number, number> = {
  3: 384, // @sm
  4: 512, // @lg
  5: 672, // @2xl
  6: 768, // @3xl
  7: 896, // @4xl
  8: 1024, // @5xl
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
  for (let n = 2; n <= columns; n++) {
    const end = n === columns ? CONTENT_MAX_PX : COUNT_STARTS[n + 1];
    max = Math.max(max, (end - GAP_PX * (n - 1)) / n);
  }
  return Math.ceil(max);
}
