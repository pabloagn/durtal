export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}
export interface ViewerSize {
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
}
export const fitScale = (size: ViewerSize) =>
  Math.min(
    (size.width * 0.9) / Math.max(1, size.contentWidth),
    (size.height * 0.9) / Math.max(1, size.contentHeight),
  );
export function clampZoom(state: ZoomState, size: ViewerSize): ZoomState {
  const fit = fitScale(size);
  const scale = Math.max(fit, Math.min(fit * 8, state.scale));
  const extentX = Math.max(0, (size.contentWidth * scale - size.width) / 2);
  const extentY = Math.max(0, (size.contentHeight * scale - size.height) / 2);
  return {
    scale,
    x: Math.max(-extentX, Math.min(extentX, state.x)),
    y: Math.max(-extentY, Math.min(extentY, state.y)),
  };
}
/** Keep the content under the pointer stationary while changing scale. */
export function zoomAt(
  state: ZoomState,
  size: ViewerSize,
  scale: number,
  x: number,
  y: number,
): ZoomState {
  const next = clampZoom({ ...state, scale }, size);
  const factor = next.scale / state.scale;
  return clampZoom(
    {
      scale: next.scale,
      x: x - (x - state.x) * factor,
      y: y - (y - state.y) * factor,
    },
    size,
  );
}
