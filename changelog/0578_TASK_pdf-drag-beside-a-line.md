# Task 0578: A PDF drag that starts beside a line selects that line

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0572
**Blocks**: None

## Overview

The last part of SLN-670. In a PDF, a mouse drag that started even a few
pixels left of a line, in the margin or in a gap between the text layer's
pieces, selected the wrong text: from the top of the page in Firefox and
WebKit, the line above in Chromium. Most drags start a little before the
first letter, so highlighting a PDF line often marked the wrong passage.

## Implementation Details

- `src/lib/reader/engines/foliate/pdf-margin-select.ts` (new): a mouse drag
  that starts beside a line, up to 64 page pixels from it, is driven by the
  reader: the selection starts at the nearer end of that line and follows
  the pointer, line by line. A drag that starts on text, a touch or pen, and a
  Shift-click stay the browser's own. Farther from any
  line a press still does what it did (panning a zoomed page).
- `src/lib/reader/engines/foliate/pdf-book.ts`: each PDF page attaches it
  once its text layer is drawn. Durtal draws its PDF pages itself, so the
  vendored pdf.js selection handling never ran on them.
- `scripts/qa/reader-engine-check.mjs` `pdfmarks`: a drag that starts 28 px
  left of a line selects that line (1440 px), and zoom and Go to mark are now
  checked at 390 px too (the ticket asks for both widths); a phone opens
  Highlights and notes by its shortcut, as its bar keeps it under More.

## Completion Notes

- Scratch check, 1440 px, drags starting 0, 4, 12, 30 and 60 px left of two
  lines: main selected the wrong text for every start off the line in all
  three browsers (24 of 30 wrong); now 30 of 30 right.
- `pdfmarks`: 36 of 36 rows in Chromium, Firefox and WebKit.
- Test: `pdf-margin-select.test.ts` (the nearest line end, nothing too far
  off or between lines, a margin drag selects the line, a drag on text, a
  touch and a Shift-click are left alone).
- No migration and no new packages.
