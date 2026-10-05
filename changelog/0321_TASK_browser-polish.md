# Task 0321: Browser polish

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Three faults found in the Safari and Firefox checks, and one more found while looking for the first.

## Implementation Details
- Book page, 375 and 390px (SLN-474): the page scrolled 8px sideways. The color glow behind the header (`ambient-crystals.tsx`) reached 24px past the content (`-left-6 -right-6`), but the page margin is 16px on a phone. It now matches the margin: 16px, and 24px from `md`.
- Publisher names review (`/publishers/review`), 390px: a "Link to …" or "Create “…”" button with a long house name was wider than the screen (51px of sideways scroll). The name now ends in an ellipsis; the line above the buttons names the house in full.
- Title-row icons in Safari, 0.55px off a 46px heading on every detail page (`alignment-audit.js`): the layout was right, the measurement was not. The serif font's family was named `serif` (next/font names it after the variable in `layout.tsx`). Safari writes the computed family without quotes, so the audit's canvas measured the generic serif (Times, cap height 30.42px) instead of PP Cirka (29.30px). Measured from Safari's pixels, the icons sit 0.16px from the true cap center. The variable is now `cirka`, so no script can mistake the family for the generic one.
- Unnamed selects in Firefox and Safari (Edit Work): the recommender select and each author's role select had no label. Chrome passed only because it counts a select's option text as its name. The recommender select now uses the visible "Recommended by" label; a role select is named "Role of <author>". Both live in the shared work form (`work-form.tsx`), so Edit Work and the quick edit dialog get them; the add-book wizard's recommender select gets the same label, and the taxonomy sort select is named "Sort".
- Book page, 390px: the carousel arrows beside "More from these collections" sat 19px below the title's first line. The 30px title wraps on a phone, and `SectionHeading` centered its action on the whole two-line title. A `CapAligned` or `CapAlignedControls` action is one title line tall, so it now sits at the top of the row (`self-start`), on the first line; every other action keeps its place.

## Completion Notes
Checked on a production build (`pnpm build`, served by `preview-local.py --start`, so the CSS is compiled as it ships):
- Sideways scroll (`scrollWidth - clientWidth`) on a book page, a person page and `/publishers/review`: 0 in Chrome, Safari and Firefox at 1440, 768 and 390px. Before, on main at 390px: 8px in Chrome, Safari and Firefox on the book page, 51px in Chrome on the review page.
- `alignment-audit.js` on a book page, a person page, a film page, `/settings` and `/collections`: 0 deviations in Chrome, Safari and Firefox at 1440 and 390px. Before: 0.55px in Safari on every detail title row; 19px in Chrome on the book page's carousel arrows at 390px. The served family is `cirka`.
- Edit Work in Firefox: the dialog opens, `design-audit.js` finds 0 unnamed controls; the recommender select has its label and each role select its name. Safari's automation did not open the dialog; the names are plain `id`/`htmlFor` and `aria-label` attributes, the same in every browser.
- `design-audit.js` on the book page, `/publishers/review`, `/library/new` and `/taxonomy`: 0 unnamed, 0 deviations. The book page lists 24–26 low-contrast items on the preview: the large stand-in letters of covers that have no picture there (no storage keys), decoration in `fg-muted`; on localhost:3100, with pictures, the same page has 0.
- `page-weight.js`: every route within budget (`/library` 296 / 300 KB).
- `pnpm typecheck` clean, lint 0 errors, `test-local.py` 2,009 tests pass.
