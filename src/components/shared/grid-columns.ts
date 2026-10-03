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
