/** Conservative scan classification from actual PDF operators in page user units.
 * Unsupported clipping, rotation/shear and image batches opt out of Auto crop. */
export function pdfImageCoverage(fn: readonly number[], args: readonly unknown[][], ops: Record<string, number>, view: readonly number[]): number[] {
  let m = [1, 0, 0, 1, 0, 0]; const stack: number[][] = []; const images: number[] = [];
  const area = (view[2] - view[0]) * (view[3] - view[1]);
  if (!(area > 0)) return [];
  for (let i = 0; i < fn.length; i++) {
    const op = fn[i];
    if (op === ops.save) stack.push([...m]);
    else if (op === ops.restore) { const saved = stack.pop(); if (!saved) return []; m = saved; }
    else if (op === ops.transform) {
      const a = args[i] as number[]; if (a.length !== 6 || !a.every(Number.isFinite)) return [];
      m = [m[0]*a[0]+m[2]*a[1], m[1]*a[0]+m[3]*a[1], m[0]*a[2]+m[2]*a[3], m[1]*a[2]+m[3]*a[3], m[0]*a[4]+m[2]*a[5]+m[4], m[1]*a[4]+m[3]*a[5]+m[5]];
    } else if (op === ops.clip || op === ops.eoClip || op === ops.paintImageMaskXObject || op === ops.paintImageXObjectRepeat || op === ops.paintInlineImageXObjectGroup || op === ops.paintImageMaskXObjectGroup || op === ops.paintImageMaskXObjectRepeat) return [];
    else if (op === ops.paintImageXObject || op === ops.paintInlineImageXObject) {
      if (m[1] !== 0 || m[2] !== 0) return [];
      const x1 = Math.max(view[0], Math.min(m[4], m[4]+m[0])), x2 = Math.min(view[2], Math.max(m[4], m[4]+m[0]));
      const y1 = Math.max(view[1], Math.min(m[5], m[5]+m[3])), y2 = Math.min(view[3], Math.max(m[5], m[5]+m[3]));
      images.push(Math.max(0,x2-x1)*Math.max(0,y2-y1)/area);
    }
  }
  return images;
}
