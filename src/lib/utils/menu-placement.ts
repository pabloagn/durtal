interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Prefer the requested side, flip for room, then constrain to the visual viewport. */
export function placeMenu(
  trigger: Rect,
  menu: { width: number; height: number },
  viewport: Rect,
  align: "start" | "center" | "end",
  side: "top" | "bottom",
) {
  const inset = 8;
  const gap = 4;
  const leftEdge = viewport.left + inset;
  const topEdge = viewport.top + inset;
  const rightEdge = viewport.left + viewport.width - inset;
  const bottomEdge = viewport.top + viewport.height - inset;
  const above = Math.max(0, Math.min(bottomEdge, trigger.top - gap) - topEdge);
  const below = Math.max(
    0,
    bottomEdge - Math.max(topEdge, trigger.top + trigger.height + gap),
  );
  const preferred = side === "top" ? above : below;
  const other = side === "top" ? below : above;
  const flipped = preferred < menu.height && other > preferred;
  const useTop = flipped ? side !== "top" : side === "top";
  const height = Math.min(menu.height, useTop ? above : below);
  const width = Math.min(menu.width, Math.max(0, rightEdge - leftEdge));
  const aligned =
    trigger.left +
    (align === "start"
      ? 0
      : align === "center"
        ? (trigger.width - width) / 2
        : trigger.width - width);
  return {
    left: Math.max(leftEdge, Math.min(aligned, rightEdge - width)),
    top: Math.max(
      topEdge,
      Math.min(
        useTop
          ? trigger.top - gap - height
          : trigger.top + trigger.height + gap,
        bottomEdge - height,
      ),
    ),
    height,
  };
}
