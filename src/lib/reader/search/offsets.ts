/** Index the original UTF-16 text nodes; empty nodes do not own boundaries. */
export function textOffsets(strings: readonly string[]): Float64Array {
  const offsets = new Float64Array(strings.length + 1);
  for (let i = 0; i < strings.length; i++)
    offsets[i + 1] = offsets[i] + strings[i].length;
  return offsets;
}

export interface NodeBoundary {
  index: number;
  offset: number;
}

/** Start chooses the following node; end chooses the preceding node. */
export function nodeBoundary(
  offsets: Float64Array,
  offset: number,
  side: "start" | "end",
): NodeBoundary {
  const count = offsets.length - 1;
  if (
    count < 1 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > offsets[count]
  )
    throw new RangeError("Invalid text boundary");
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (side === "start" ? offsets[mid] <= offset : offsets[mid] < offset)
      low = mid + 1;
    else high = mid;
  }
  const index = Math.max(0, Math.min(count - 1, low - 1));
  return { index, offset: offset - offsets[index] };
}

export function rangeOffsets(
  offsets: Float64Array,
  start: number,
  end: number,
) {
  if (end <= start) throw new RangeError("A search range must contain text");
  return {
    start: nodeBoundary(offsets, start, "start"),
    end: nodeBoundary(offsets, end, "end"),
  };
}
