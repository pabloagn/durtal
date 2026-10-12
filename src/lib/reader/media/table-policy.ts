export interface TableScrollState {
  /** Normalized physical distance from the left edge, including in RTL. */
  left: number;
  width: number;
  viewport: number;
}

/** Finger moving left reveals content to the right, and vice versa. */
export function tableCanTakeSwipe(
  state: TableScrollState,
  dx: number,
): boolean {
  if (![state.left, state.width, state.viewport, dx].every(Number.isFinite))
    return false;
  const maximum = state.width - state.viewport;
  if (maximum <= 0 || state.viewport <= 0 || dx === 0) return false;
  const left = Math.max(0, Math.min(maximum, state.left));
  return dx < 0 ? left < maximum - 0.5 : left > 0.5;
}

/** Modern RTL scrollLeft is zero at the right edge and negative to the left. */
export function physicalTableScrollLeft(
  scrollLeft: number,
  maximum: number,
  direction: "ltr" | "rtl",
): number {
  if (!Number.isFinite(scrollLeft) || !Number.isFinite(maximum)) return 0;
  const max = Math.max(0, maximum);
  return Math.max(
    0,
    Math.min(max, direction === "rtl" ? max + scrollLeft : scrollLeft),
  );
}
