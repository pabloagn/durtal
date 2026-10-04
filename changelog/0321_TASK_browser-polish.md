# Task 0321: Browser polish

**Status**: In Progress
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Three faults found in the Safari and Firefox checks, and one more found while looking for the first.

## Implementation Details
- Book page, 390px: the page scrolled 8px sideways. The color glow behind the header (`ambient-crystals.tsx`) reached 24px past the content (`-left-6 -right-6`), but the page margin is 16px on a phone. It now matches the margin: 16px, and 24px from `md`.
- Publisher names review (`/publishers/review`), 390px: a "Link to …" or "Create “…”" button with a long house name was wider than the screen (51px of sideways scroll). The name now ends in an ellipsis; the line above the buttons names the house in full.
- Title-row icons in Safari, 0.55px off a 46px heading on every detail page (`alignment-audit.js`): the layout was right, the measurement was not. The serif font's family was named `serif` (next/font names it after the variable in `layout.tsx`). Safari writes the computed family without quotes, so the audit's canvas measured the generic serif (Times, cap height 30.42px) instead of PP Cirka (29.30px). Measured from Safari's pixels, the icons sit 0.16px from the true cap center. The variable is now `cirka`, so no script can mistake the family for the generic one.
- Unnamed selects in Firefox and Safari (Edit Work): the recommender select and each author's role select had no label. Chrome passed only because it counts a select's option text as its name. The recommender select now uses the visible "Recommended by" label; a role select is named "Role of <author>". The same selects in the quick edit dialog and the add-book wizard get the same names, and the taxonomy sort select is named "Sort".

## Completion Notes
SUMMARY
