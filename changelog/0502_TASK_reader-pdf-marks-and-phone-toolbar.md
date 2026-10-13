# Task 0502: Reader fixes, batch 3 (PDF marks, the phone selection toolbar)

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0501
**Blocks**: None

## Overview

The third batch from the 13 October e-book review (`/mnt/project-files/ebooks/review-2026-10-13.md`): PDF highlights that were saved but never drawn (SLN-670), and the selection toolbar and Look up covering most of a phone's screen (SLN-678).

## Implementation Details

- **SLN-670, PDF marks were never drawn.** `resolvePdfAnnotation` called a mark exact only when its saved rectangles matched the measured text to 0.02 points. Rectangles saved from a selection differ from the measured text by a fraction of a line (0.7 points on the fixture), so every mark went on to scan the other pages. There the fuzzy match runs out of its work allowance and defers, the result was "pending", and the controller keeps a pending result until the mark changes, so it was never drawn.
  - The same words, alone on their own page of the same file, are now the mark's place, and the measured rectangles are drawn. The first resolve rewrites the saved rectangles through the existing re-anchor path.
  - Drawn marks take no pointer events (`pdf-decorations.ts`), so a selection can start on highlighted text. A plain click that ends on a mark, with nothing selected, still opens it, through one capture listener per page document.
- **SLN-678, the phone toolbar.** On touch the selection toolbar is one row, 48 px: the five swatches, Note and Look up (icons on touch, words with a mouse), then More. What does not fit scrolls inside the row and never wraps.
  - More opens a second row with Copy, Read aloud from here and the less used actions. Those are a new `selection-more` slot; Save quote moved there. With a mouse they stay inline, in the same order as before.
  - The docked toolbar sits at the bottom unless the selection is there; then it sits at the top.
  - It steps aside while Look up's sheet is open (`onSheet` on `LookupLayer`).
  - Look up's tabs are one row that scrolls, keeping the chosen tab in view. The "Add one in Settings › Reader" links are 44 px tall on touch.
  - On touch, pausing or stopping Read aloud no longer selects the sentence (`selectsSentences` on the speech session), so it opens no toolbar over the text.

## Completion Notes

- Tests: the PDF resolver on its own page with slightly different rectangles, marks that let a selection start and open on a click, the touch toolbar's row, More and Look up cover, and speech not selecting on touch.
- `scripts/qa/reader-engine-check.mjs` gains `pdfmarks`: a dragged highlight on the PDF fixture is drawn, and drawn again after a reload (passes in Chromium, Firefox and WebKit).
- Checked by hand in the three browsers: marks scale with the text after zooming in twice (711 px against a 718 px line), a click on a mark opens its actions, and a drag that starts on a mark selects (Firefox, WebKit).
- Not covered yet:
  - SLN-670: zoom and "Go to mark" are not in the automated check; a mark whose file changed still waits when the other pages defer.
  - Found while checking, not changed here: in Chromium a drag that starts left of a PDF line snaps to text above it (the PDF text layer has no end-of-content element), and Escape does not close the highlight actions menu after a click on a mark (EPUB too).
  - SLN-678: at 320 px the last 52 px of the row (Look up) scroll; Save quote stays an action until SLN-664 decides it.
- No migration and no new packages.
