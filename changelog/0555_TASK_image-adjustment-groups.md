# Task 0555: Image adjustments in three groups

**Status**: Completed
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
- With a mouse, each slider is a block 10px under its label, so no line box adds space above it. Rows are 16px apart. On touch the 44px slider sits right under its label, as before.
- Rotation (SLN-333) is not part of this; it will join Framing.
- **"Or paste image URL"** in Manage media and the edition cover dialog: its chevron sits on the label's cap height (`CapAligned`). It was 1.5px off in every browser, and the alignment audit flagged it in the media dialog.

## Completion Notes

- `src/__tests__/ui/image-adjustment-groups.test.ts` covers the groups for a plain image, a cropped subject and author monochrome, and the value text and colour.
- Checked in the browser on a production build with a seeded preview. A test poster was uploaded to a film through Manage media, which shows the editor inline with Framing.
  - Each group was opened in Chromium, Firefox and WebKit at 1440 (mouse), 390 and 320 (touch).
  - The alignment and design audits are clean on all 27 loads, with no overflow.
  - On touch the groups and sliders are 44px tall.

**Review fix (#317):** when only one group is left (a person's image keeps monochrome, so no Colour, and an image with no crop has no Framing), the editor shows Tone's sliders with no one-option switch over them.
