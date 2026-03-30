// ── Collage Layout Algorithm ──────────────────────────────────────────────────
//
// Produces a deterministic, symmetric collage grid layout for a list of images.
// Same seed + same images always produces the same layout.

export interface CollageCell {
  mediaId: string;
  row: number;      // grid row start (0-based)
  col: number;      // grid col start (0-based)
  rowSpan: number;  // how many rows this cell spans
  colSpan: number;  // how many cols this cell spans
}

export interface CollageBlock {
  columns: number;  // total columns in this block
  rows: number;     // total rows in this block
  cells: CollageCell[];
}

export interface CollageLayoutData {
  blocks: CollageBlock[];
}

// ── Image orientation helpers ─────────────────────────────────────────────────

type Orientation = "portrait" | "landscape" | "square";

interface ImageMeta {
  id: string;
  width: number | null;
  height: number | null;
}

function orientation(img: ImageMeta): Orientation {
  const w = img.width ?? 1;
  const h = img.height ?? 1;
  const ratio = w / h;
  if (ratio < 0.85) return "portrait";
  if (ratio > 1.15) return "landscape";
  return "square";
}

// ── Deterministic seeded RNG (xorshift32) ─────────────────────────────────────

function makeRng(seed: number) {
  let s = seed === 0 ? 0xdeadbeef : seed >>> 0;
  return function (): number {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function seededPick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Template definitions ──────────────────────────────────────────────────────
//
// Each template describes how N images are laid out in a block.
// Templates are arrays of {row, col, rowSpan, colSpan} slot descriptors.
// The total (cols, rows) of the block enclosing all cells is also stored.

interface SlotTemplate {
  cols: number;
  rows: number;
  slots: Array<{ row: number; col: number; rowSpan: number; colSpan: number }>;
}

const TEMPLATES: Record<number, SlotTemplate[]> = {
  1: [
    {
      cols: 1,
      rows: 1,
      slots: [{ row: 0, col: 0, rowSpan: 1, colSpan: 1 }],
    },
  ],

  2: [
    // Side-by-side
    {
      cols: 2,
      rows: 1,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
      ],
    },
    // Stacked
    {
      cols: 1,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
      ],
    },
  ],

  3: [
    // 1 large left (2 rows) + 2 small right (stacked)
    {
      cols: 2,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
      ],
    },
    // 1 large right + 2 small left (stacked)
    {
      cols: 2,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 2, colSpan: 1 },
      ],
    },
    // 1 wide top + 2 equal bottom
    {
      cols: 2,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 2 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
      ],
    },
    // 2 equal top + 1 wide bottom
    {
      cols: 2,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 2 },
      ],
    },
  ],

  4: [
    // 2x2 equal grid
    {
      cols: 2,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
      ],
    },
    // 1 large top-left + 3 in L-shape
    {
      cols: 3,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 0, col: 2, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 2 }, // NOTE: overlaps with large cell — use variant below
      ],
    },
    // 1 large top-right + 3 in L-shape
    {
      cols: 3,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 2, colSpan: 2 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 }, // duplicate — replace with clean variant
      ],
    },
    // Clean: 1 wide + 3 narrow in row
    {
      cols: 3,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 3 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
      ],
    },
  ],

  5: [
    // 1 big left (2x2) + 4 small in 2x2 right
    {
      cols: 4,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 0, col: 2, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 3, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 3, rowSpan: 1, colSpan: 1 },
      ],
    },
    // 4 small left + 1 big right (2x2)
    {
      cols: 4,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 2, rowSpan: 2, colSpan: 2 },
      ],
    },
    // Row of 3 + row of 2
    {
      cols: 3,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 2, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 1, rowSpan: 1, colSpan: 2 },
      ],
    },
  ],

  6: [
    // 3x2 uniform grid
    {
      cols: 3,
      rows: 2,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 2, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
      ],
    },
    // 1 large + 5 small
    {
      cols: 4,
      rows: 3,
      slots: [
        { row: 0, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 0, col: 2, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 3, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 3, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 0, rowSpan: 1, colSpan: 4 },
      ],
    },
    // 2x3 (tall columns)
    {
      cols: 2,
      rows: 3,
      slots: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 1, rowSpan: 1, colSpan: 1 },
      ],
    },
  ],
};

// ── Orientation scoring ────────────────────────────────────────────────────────
//
// Assign images to slots preferring orientation matches.
// Portrait images → tall slots (rowSpan > colSpan)
// Landscape images → wide slots (colSpan > rowSpan)
// Square images → any slot

function slotOrientation(slot: {
  rowSpan: number;
  colSpan: number;
}): Orientation {
  if (slot.colSpan > slot.rowSpan) return "landscape";
  if (slot.rowSpan > slot.colSpan) return "portrait";
  return "square";
}

function orientationScore(
  imgOrientation: Orientation,
  slotOri: Orientation,
): number {
  if (imgOrientation === slotOri) return 3;
  if (imgOrientation === "square" || slotOri === "square") return 2;
  return 0; // mismatch
}

function assignImagesToSlots(
  images: ImageMeta[],
  template: SlotTemplate,
): CollageCell[] {
  const slots = [...template.slots];
  const imgs = [...images];

  // Score each image-slot pair and greedily assign best matches
  const assigned: Array<{ imgIdx: number; slotIdx: number; score: number }> =
    [];
  const usedImgs = new Set<number>();
  const usedSlots = new Set<number>();

  // Build all pairs
  const pairs: Array<{ i: number; j: number; score: number }> = [];
  for (let i = 0; i < imgs.length; i++) {
    const ori = orientation(imgs[i]);
    for (let j = 0; j < slots.length; j++) {
      pairs.push({
        i,
        j,
        score: orientationScore(ori, slotOrientation(slots[j])),
      });
    }
  }

  // Sort by score desc, then assign greedily
  pairs.sort((a, b) => b.score - a.score);
  for (const { i, j } of pairs) {
    if (usedImgs.has(i) || usedSlots.has(j)) continue;
    assigned.push({ imgIdx: i, slotIdx: j, score: 0 });
    usedImgs.add(i);
    usedSlots.add(j);
    if (usedImgs.size === imgs.length) break;
  }

  // Map to CollageCell
  return assigned.map(({ imgIdx, slotIdx }) => ({
    mediaId: imgs[imgIdx].id,
    row: slots[slotIdx].row,
    col: slots[slotIdx].col,
    rowSpan: slots[slotIdx].rowSpan,
    colSpan: slots[slotIdx].colSpan,
  }));
}

// ── Main layout function ──────────────────────────────────────────────────────

/**
 * Compute a collage layout for the given images.
 *
 * For image counts > 6 the images are chunked into groups of 3–6 and each
 * chunk gets its own block.
 *
 * @param images  Array of images with id + optional dimensions
 * @param seed    Integer seed for deterministic template selection
 * @returns       CollageLayoutData with one or more blocks
 */
export function computeCollageLayout(
  images: ImageMeta[],
  seed: number,
): CollageLayoutData {
  if (images.length === 0) return { blocks: [] };

  const rng = makeRng(seed);

  // Chunk images into groups of 3–6
  const chunks: ImageMeta[][] = [];
  let remaining = [...images];

  while (remaining.length > 0) {
    if (remaining.length <= 6) {
      chunks.push(remaining);
      remaining = [];
    } else {
      // Take 4–6 images per chunk; pick a size that balances the remainder
      let chunkSize = 4;
      if (remaining.length >= 12 && remaining.length % 4 === 0) chunkSize = 4;
      else if (remaining.length % 3 === 0) chunkSize = 3;
      else if (remaining.length % 5 === 0) chunkSize = 5;
      else if (remaining.length % 6 === 0) chunkSize = 6;
      else chunkSize = 4;

      chunks.push(remaining.slice(0, chunkSize));
      remaining = remaining.slice(chunkSize);
    }
  }

  const blocks: CollageBlock[] = chunks.map((chunk) => {
    const count = Math.min(chunk.length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
    const templates = TEMPLATES[count];

    // Pick template using seeded RNG
    const template = seededPick(templates ?? TEMPLATES[1], rng);

    // Adjust if chunk is smaller than template expects (shouldn't happen but safety)
    const activeChunk = chunk.slice(0, template.slots.length);

    const cells = assignImagesToSlots(activeChunk, template);

    return {
      columns: template.cols,
      rows: template.rows,
      cells,
    };
  });

  return { blocks };
}
