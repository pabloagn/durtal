export interface ContentBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Exclusive right/bottom edges; null means retain the entire page. */
export function detectContentBox(
  luma: Uint8Array,
  width: number,
  height: number,
): ContentBox | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(width * height) ||
    luma.length !== width * height
  )
    throw new RangeError("Invalid luma page dimensions");
  const frameX = Math.max(1, Math.ceil(width * 0.02));
  const frameY = Math.max(1, Math.ceil(height * 0.02));
  const histogram = new Uint32Array(256);
  let samples = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x < frameX ||
        x >= width - frameX ||
        y < frameY ||
        y >= height - frameY
      ) {
        histogram[luma[y * width + x]]++;
        samples++;
      }
    }
  }
  const lowerAt = Math.floor((samples - 1) / 2);
  const upperAt = Math.floor(samples / 2);
  let count = 0;
  let lower: number | undefined;
  let paper = 0;
  for (let tone = 0; tone < histogram.length; tone++) {
    count += histogram[tone];
    if (lower === undefined && count > lowerAt) lower = tone;
    if (count > upperAt) {
      paper = (lower! + tone) / 2;
      break;
    }
  }
  const rows = new Uint32Array(height);
  const columns = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.abs(luma[y * width + x] - paper) > 40) {
        rows[y]++;
        columns[x]++;
      }
    }
  }
  const firstRow = rows.findIndex((n) => n >= width * 0.004);
  const firstColumn = columns.findIndex((n) => n >= height * 0.004);
  if (firstRow < 0 || firstColumn < 0) return null;
  let lastRow = height - 1;
  let lastColumn = width - 1;
  while (rows[lastRow] < width * 0.004) lastRow--;
  while (columns[lastColumn] < height * 0.004) lastColumn--;
  const box = {
    left: Math.min(Math.floor(width * 0.25), Math.max(0, firstColumn - frameX)),
    top: Math.min(Math.floor(height * 0.25), Math.max(0, firstRow - frameY)),
    right: Math.max(
      Math.ceil(width * 0.75),
      Math.min(width, lastColumn + 1 + frameX),
    ),
    bottom: Math.max(
      Math.ceil(height * 0.75),
      Math.min(height, lastRow + 1 + frameY),
    ),
  };
  if (
    (box.right - box.left) * (box.bottom - box.top) < width * height * 0.4 ||
    (box.left === 0 &&
      box.top === 0 &&
      box.right === width &&
      box.bottom === height)
  )
    return null;
  return box;
}

/** Auto crop only identifies a scan when a single image covers >=90%. */
export function isScannedPage(
  imageCoverage: readonly number[],
  hasText: boolean,
): boolean {
  return (
    !hasText &&
    imageCoverage.length === 1 &&
    Number.isFinite(imageCoverage[0]) &&
    imageCoverage[0] >= 0.9 &&
    imageCoverage[0] <= 1
  );
}

export function cropEnabled(
  mode: "auto" | "on" | "off",
  firstPageIsScan: boolean,
): boolean {
  return mode === "on" || (mode === "auto" && firstPageIsScan);
}
