# Task 0057: Gallery Collage Grid for Books and Authors

**Status**: Completed
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0048
**Blocks**: None

## Overview
Create a visually stunning gallery grid for displaying images on both book detail pages and author detail pages. The grid should present images in a collage layout that is symmetric, balanced, and aesthetically pleasing -- inspired by the reference screenshot showing rectangular collage compositions.

The goal is to make the gallery a visual centerpiece: a gorgeous, symmetric grid where images fit together perfectly without excessive zooming or pixelation. The layout must be pre-computed and persisted so it remains stable across page loads.

## Edge Cases (all must be handled)
- **Zero images**: No collage shown (section hidden or subtle empty state)
- **One image**: Single image displayed standalone, centered
- **Two images**: Side by side -- orientation (horizontal or vertical split) chosen based on aspect ratios
- **Three images**: Creative asymmetric layout (e.g., one large + two small stacked)
- **Four+ images**: Increasingly complex collage grids using tiling templates
- **100+ images**: Infinite scroll -- collage renders in "pages" of collage blocks, loading more as the user scrolls down

## Schema Changes

### New table: `gallery_layouts`
Separate normalized table (industry standard for long-term maintainability and performance):

```
gallery_layouts
  id              uuid, PK
  entityType      text, NOT NULL  -- 'work' | 'author'
  entityId        uuid, NOT NULL  -- references works.id or authors.id
  layoutData      jsonb, NOT NULL -- computed layout: cell positions, sizes, media IDs, seed
  seed            integer         -- random seed used for reproducibility
  imageCount      integer         -- cached count for quick invalidation check
  containerWidth  integer         -- the reference width used for computation
  createdAt       timestamp
  updatedAt       timestamp

  UNIQUE(entityType, entityId)
```

The `layoutData` JSON stores:
- Array of layout "blocks" (each block is a self-contained collage tile set)
- Per block: grid template definition + array of cells with `{ mediaId, row, col, rowSpan, colSpan }`
- The seed used for randomization (so the same seed reproduces the same layout)

### Migration
- Create `gallery_layouts` table via Drizzle migration
- Update `docs/02_DATA_MODEL.md`

## Layout Algorithm

### Inputs
- List of gallery media items with actual dimensions (`width`, `height` from media table)
- Container reference width
- Min/max cell dimensions (configurable constants to prevent tiny thumbnails or oversized/pixelated cells)
- Random seed (for reproducible "randomness")

### Computation
- **Resolution-aware**: each image's aspect ratio informs which cell shape it fits best (tall, wide, square)
- **Template-based for small counts** (1-6 images): hand-crafted templates that look beautiful
- **Tiling algorithm for larger counts**: groups images into blocks of 4-8, applies templates per block, stacks blocks vertically
- **Constraints**:
  - All cells must fill completely -- no gaps, no orphan spaces
  - Uniform thin gaps between cells (2-4px)
  - No image zoomed beyond a threshold (e.g., 150% of natural size) to prevent pixelation
  - Cell size distribution should feel balanced and harmonious
- **Infinite scroll chunks**: for large galleries, compute layout in chunks (e.g., 12-16 images per chunk), each chunk is a self-contained collage block

### When layout is (re)computed
- First time gallery is viewed and no layout exists
- A gallery image is added (including bulk upload)
- A gallery image is deleted
- User clicks "Randomize" button (new seed)

### Persistence
- Computed layout stored in `gallery_layouts` table
- On page load: read layout from DB, render directly (no computation)
- `imageCount` field enables quick staleness check: if media count != stored count, recompute

## Randomizer Button
- Dice/shuffle icon button visible on the gallery section
- Clicking re-computes the layout with a new random seed
- New layout persisted immediately
- Subtle animation during recomputation (skeleton or fade)

## Bulk Upload
- Existing `UploadZone` supports `multiple` prop -- verify it works for many files (10-50+)
- Progress indicators for each file in bulk uploads
- After bulk upload completes, trigger layout recomputation
- Accessible via the "Manage Media" option in the unified action menu (Task 0055)

## Visual Design
- Thin uniform gap between grid cells (2-4px)
- 2px border radius on individual cells (per design system)
- Dark background behind the grid
- On hover over a cell: subtle brightness lift
- Clicking a cell opens the image in the lightbox (Task 0048)
- Images use `object-fit: cover` with minimal cropping (informed by aspect ratio matching in layout algorithm)

## Infinite Scroll
- For galleries with many images, render collage blocks progressively
- Use Intersection Observer to load next chunk as user scrolls
- Each chunk is a self-contained collage block (no cross-chunk dependencies)
- Smooth loading with skeleton/placeholder during computation

## Replaces
- The current `media-gallery.tsx` masonry layout is replaced by this collage grid on detail pages
