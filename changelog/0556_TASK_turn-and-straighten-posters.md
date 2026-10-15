# Task 0556: Turn and straighten posters and backgrounds

**Status**: In Progress
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0555 (SLN-557 image adjustment groups)
**Blocks**: None

## Overview

SLN-333: a poster or background that was scanned or photographed on its side, or a little crooked, can be turned and straightened in the image editor. The turn is written into the display files on Save, like a crop, so every view shows it: cards, lists, the lightbox and thumbnails. The original image is never changed, and Reset brings it back.

This first part covers framed media (posters and backgrounds), which already write their crop into files. Other subjects (gallery images, attachments) come later.

## Implementation Details

- **Editor** (`src/components/media/image-adjustment-editor.tsx`). The Framing group gains Turn left and Turn right (quarter turns) and a Straighten slider (-45 to 45 degrees, in whole degrees). The preview draws the turned image on a canvas, cut as Save cuts it, and frames it with the same zoom and focal point as an upright image. Reset all also sets the image upright.
- **Geometry** (`src/lib/media/crop.ts`). `AppliedCrop` gains optional `turn` and `straighten`. `rotatedFrame()` gives the largest centred box of the turned image's shape with no empty corner once straightened. `nextTurn()`, `isUpright()`; `isNoCrop()` and `sameCrop()` count a turn.
- **Files** (`src/lib/media/display.ts`). `buildDisplayFiles` turns the upright image (its EXIF orientation applied) losslessly, cuts the `rotatedFrame` box a pixel in from each edge (the edge pixels are blended with the empty background), drops the alpha it added from an opaque image, then crops to the frame as before. A turned image always gets new files and keeps the original as `uncropped_s3_key`. A contained image can be turned but is never cut to the frame.
- **Save** (`src/lib/actions/image-adjustments.ts`). The crop input takes `turn` (0, 90, 180 or 270) and `straighten` (-45 to 45, whole degrees). They are stored in `media.applied_crop` only when set, so an upright crop reads as before. `getImagePresentation` returns both.
- **Where the angle lives.** The angle is stored in `media.applied_crop` with the crop, not in the `image_adjustments` settings: `applied_crop` describes exactly what the display files hold, and the settings follow the file key from one version to the next. No migration: `applied_crop` is JSONB. `docs/02_DATA_MODEL.md` describes the new shape.
- **Earlier work.** Nothing for SLN-333 is on main. An unmerged branch (`codex/sln-333-rotation`) rotated images when they are shown instead of in the files; this task bakes the turn into the files as decided, so it does not reuse that branch.

- **Pull-outs.** Turn left, Turn right and Compare are ghost buttons that start a row under the sliders; each pulls out by its own 10px padding (`-ml-2.5`, the same on touch, where the Button keeps its padding), so its icon or label starts on the sliders' edge (docs/03, Spacing Scale). Compare's was a review nit on #317.

## Completion Notes

Tests:

- `src/__tests__/utils/media-crop.test.ts`: turns, the straightened box (each corner stays inside the image), and crop comparisons with a turn.
- `src/__tests__/ui/image-adjustment-groups.test.ts`: Framing shows Straighten; three turns and a straightening are saved with the crop.
- `src/__tests__/integration/image-adjustments.test.ts` (database): a quarter turn moves each quadrant where it should go and keeps the original byte for byte; a straightening alone writes opaque files of the frame's shape; upright again restores the original; a turn of 45 or a straightening of 46 is refused.

Checked on a production build with the seeded preview:

- A 600x900 quadrant poster, uploaded to a film, turned right and straightened 2 degrees, then saved. The display files are 379x568 and opaque, cut to 2:3 from the 853x568 straightened box, as the editor's preview showed. The original stays 600x900 as `uncropped_s3_key`, and `applied_crop` is `{ x: 50, y: 50, zoom: 100, turn: 90, straighten: 2 }`. Reopened, the editor shows +2° and the turned preview.
- Alignment and design audits on the editor, each group, in Chromium, Firefox and WebKit at 1440, 390 and 320: nothing over 0.5px, with no overflow. That needs the dialog type fix (0557); without it, the turn buttons' icons sat 1.5px off their serif labels.
- page-weight passes.
- `pnpm test:local` (every suite, with the editor groups and the dialog fix underneath): 662 files, 7101 tests pass.
- Measured after the pull-outs, in Chromium: the Zoom label, Turn left's icon and Compare's label all start at x = 360 at 1440 (mouse) and x = 24 at 390 (touch).
