# Task 0559: Image editor for paintings and perfumes, and a cheaper Straighten preview

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0555 (image adjustment groups), 0556 (turn and straighten posters)
**Blocks**: None

## Overview

Two follow-ups from the review of 0556 (SLN-333):

- **Framing controls that failed on Save.** The image editor offered Zoom, Horizontal and Vertical on a painting's or a perfume's poster. Those images are always shown whole, so Save refused any change to them ("This image is always shown whole and cannot be cropped").
- **A slow Straighten preview.** Each step of the slider drew the image turned and then encoded it as a JPEG for the preview, about 7 frames a second on a phone-speed CPU.

## Implementation Details

- `src/lib/media/display.ts`: `mediaPolicy(row)` gives a stored image's owner policy. `buildDisplayFiles` uses it, and it still refuses a framing on a contained image.
- `src/lib/actions/image-adjustments.ts`: `getImagePresentation` now returns `contained` for an image its policy shows whole: paintings, perfumes, art objects, formulations and organizations.
  - For such an image the editor starts centred, even when an old CSS framing is stored, so Save never sends a framing.
  - It also has no frame aspect.
- `src/components/media/image-adjustment-editor.tsx`, for a contained image:
  - Framing offers Straighten, Turn left and Turn right only.
  - The preview shows the image whole (`object-contain`), with no drag to move it.
- **The Straighten preview** (`AdjustmentPreview`):
  - The image is scaled down once, to at most 1200px on its long side.
  - Each step only draws it turned on a canvas, shown as the preview. Nothing is encoded, and the full-size file is still written on Save.
  - A canvas shown on the page needs no read-back, so an image from another origin is previewed turned too. Before, it fell back to upright.
  - An upright image is the plain `<img>` as before.

## Completion Notes

- **Tests:**
  - `image-adjustment-groups.test.ts`: a contained image offers Straighten and the turns only, and previews whole.
  - `integration/image-adjustments.test.ts`: a painting's and a perfume's poster start centred despite a stored framing. A zoom is refused, and a turn writes the whole image turned (450 x 300 from 300 x 450).
- **Browser checks** ran on a production build with the seeded preview and a 2400 x 3600 poster. They covered a painting, a perfume and a film, in Chromium, Firefox and WebKit at 1440, 768, 390 and 320.
  - The painting and the perfume offer only Straighten, with no drag.
  - The film still offers Zoom, Horizontal, Vertical and Straighten.
  - Turned and straightened, the preview is the canvas, whole (`contain`) for the painting and the perfume and framed (`cover`) for the film.
  - The alignment and design audits found nothing in the open editor.
- **Timing** (Chromium, the same image, 20 steps of the slider):

  | | Main-thread work per step | On a 4x slower CPU |
  | --- | --- | --- |
  | Before (JPEG per step) | 13 ms | 66 ms (about 15 a second) |
  | After (canvas) | 2.6 ms | 14 ms |

- **Page weight:** every route is within budget.
- `pnpm typecheck` is clean. `pnpm lint` adds no warning: the `<img>` warning is the editor's existing one, moved.
