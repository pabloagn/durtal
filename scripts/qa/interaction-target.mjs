/** Effective press area, including centered hit layers and clipping.
 * Geometry follows touch-audit.js: scrolling can reveal a whole target,
 * whereas hidden/clip ancestors permanently cut it. Pointer-inert decoration
 * is never allowed to enlarge a target.
 */
export function effectiveTarget(el) {
  const rect = el.getBoundingClientRect();
  let box = {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
  };
  if (getComputedStyle(el).position !== "static") {
    for (const pseudo of ["::before", "::after"]) {
      const s = getComputedStyle(el, pseudo);
      if (
        s.content === "none" ||
        s.content === "normal" ||
        s.position !== "absolute" ||
        s.pointerEvents === "none" ||
        s.display === "none" ||
        s.visibility === "hidden"
      )
        continue;
      const width = parseFloat(s.width),
        height = parseFloat(s.height);
      if (!width || !height) continue;
      // Only count the centered hit layer used by touch-hit and Harmonize.
      // Do not mistake an unrelated, positioned badge for a larger hit area.
      const matrix = s.transform
        .match(/^matrix\(([^)]+)\)$/)?.[1]
        .split(",")
        .map(Number);
      const centered =
        (s.left === "50%" ||
          Math.abs(parseFloat(s.left) - rect.width / 2) <= 0.5) &&
        (s.top === "50%" ||
          Math.abs(parseFloat(s.top) - rect.height / 2) <= 0.5) &&
        matrix &&
        matrix[0] === 1 &&
        matrix[1] === 0 &&
        matrix[2] === 0 &&
        matrix[3] === 1 &&
        Math.abs(matrix[4] + width / 2) <= 0.5 &&
        Math.abs(matrix[5] + height / 2) <= 0.5;
      if (!centered) continue;
      const cx = (rect.left + rect.right) / 2,
        cy = (rect.top + rect.bottom) / 2;
      box = {
        left: Math.min(box.left, cx - width / 2),
        right: Math.max(box.right, cx + width / 2),
        top: Math.min(box.top, cy - height / 2),
        bottom: Math.max(box.bottom, cy + height / 2),
      };
    }
  }
  function reach(from, rect) {
    let { left, right, top, bottom } = rect;
    let width = null,
      height = null;
    for (
      let n = from.parentElement;
      n &&
      n !== document.documentElement &&
      (width === null || height === null);
      n = n.parentElement
    ) {
      const s = getComputedStyle(n),
        c = n.getBoundingClientRect();
      for (const axis of ["x", "y"]) {
        if ((axis === "x" ? width : height) !== null) continue;
        const overflow = axis === "x" ? s.overflowX : s.overflowY;
        if (!/hidden|clip|auto|scroll/.test(overflow)) continue;
        const more =
          axis === "x"
            ? n.scrollWidth - n.clientWidth
            : n.scrollHeight - n.clientHeight;
        if (/auto|scroll/.test(overflow) && more > 1) {
          const view = reach(n, c);
          if (axis === "x")
            width = Math.min(
              Math.max(0, right - left),
              view.width,
              n.clientWidth,
            );
          else
            height = Math.min(
              Math.max(0, bottom - top),
              view.height,
              n.clientHeight,
            );
        } else if (axis === "x") {
          left = Math.max(left, c.left);
          right = Math.min(right, c.right);
        } else {
          top = Math.max(top, c.top);
          bottom = Math.min(bottom, c.bottom);
        }
      }
    }
    width ??= Math.max(0, right - left);
    height ??= Math.max(0, bottom - top);
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    };
  }
  return reach(el, box);
}
