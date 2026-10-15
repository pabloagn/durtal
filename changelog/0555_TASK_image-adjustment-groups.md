# Task 0555: Image adjustments in three groups

**Status**: In Progress
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0553 (busy buttons)
**Blocks**: None

## Overview

SLN-557. The image adjustment editor showed a wrapping row of ten small buttons (Exposure, Brightness, Contrast, Saturation, Monochrome, Sepia, Softness, Zoom, Position X, Position Y) over one slider. The chosen setting sat apart from its value and slider. Wrapping left Position X and Position Y on a second row, and nothing grouped related settings.

## Implementation Details

- `src/components/media/image-adjustment-editor.tsx`.
- **Three groups**, chosen with the shared `SegmentedControl`, as the note dialog chooses Quote or Note:
  - **Tone**: Exposure, Brightness, Contrast, Softness;
  - **Colour**: Saturation, Monochrome, Sepia;
  - **Framing**: Zoom, Horizontal, Vertical.
- A group shows all of its controls at once. Each control has its label and value on one line, with its slider under them.
- **Which groups show.** Framing appears only for a subject the editor can crop (posters and backgrounds), as before. Colour is left out while author monochrome is locked on; the "Author monochrome stays on" note stays.
- **Values** are written to the slider's step, with the unit: "+0.35 EV", "120%", "1.5 px". A value off its default turns `fg-primary`; at the default it is `fg-secondary`. So the changed settings stand out.
- **Reset is now "Reset all"**: it resets every group, as it did before.
- "Position X" and "Position Y" are now "Horizontal" and "Vertical".
- Everything else is unchanged: the preview, dragging to frame, Compare, Save, the busy Save, keyboard access (one Tab stop for the groups, arrow keys between them) and the 44px touch sliders.
- Rotation (SLN-333) is not part of this; it will join Framing.

## Completion Notes

- `src/__tests__/ui/image-adjustment-groups.test.ts` covers the groups for a plain image, a cropped subject and author monochrome, and the value text and colour.
