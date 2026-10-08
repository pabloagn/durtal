# Task 0398: The touch audit measures a scrolled control whole

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-548, from the review of #163. `scripts/qa/touch-audit.js` cut a
control's press area by every ancestor that clips its overflow. A dialog is a
`glass overflow-hidden` shell around a scrolling body, so whichever control
sat half-scrolled at the body's edge was listed as under 44px: the Credit
field in the image details, a tab, a slider, depending on the scroll. The
reader scrolls such a control into view, so it is not small. The audit now
stops cutting at the first ancestor that scrolls it. No change to the app.

## Implementation Details

- `reach` walks the ancestors once per axis. A box with hidden or clipped
  overflow cuts the target, as before. A box that scrolls on that axis (auto
  or scroll overflow, with more to show) ends the walk for that axis: the
  control counts at its own size, capped by what the scroller itself shows
  (its own reach, taken the same way, and its client size). A box with auto
  overflow and nothing more to show only clips.
- A control scrolled out of view now counts at its size; before, it was cut
  to nothing and skipped, so a small one hid there.
- docs/03, Keyboard, touch and motion, says how a scrolled control is
  measured.

## Completion Notes

- Preview of main (2f696f56, large seed, a cover uploaded to a book), the
  book's media manager at 390px with touch in headless Chrome, Firefox and
  WebKit. Its body was scrolled through every 7px (about 150 positions per
  browser). Main's audit listed something at 90 to 92 positions, 24 controls
  in all, among them the Credit field ("Photographer, museum or
  collection"), the tabs, the adjustment sliders and Compare. The new audit
  listed nothing at any position. Scrolled into view, the Credit field is 44px
  tall.
- Real failures still fail, in the same dialog in all three browsers. A
  planted 20 x 20 button in the dialog body is listed by both audits when in
  view, and only by the new one when scrolled out of view (main skipped it).
  A planted 60px button inside a 30px box that clips without scrolling is
  listed as 60 x 30 by both.
- Both audits on 52 routes (every page, with a record for each detail page
  the seed has) in headless Chrome, Firefox and WebKit at 390px with touch,
  at the top and the bottom of the page: identical results on every route,
  nothing dropped and nothing added. Five routes fail on main with both:
  /perfumes/new, /films/new and /paintings/new (the "Add …" and "Unknown"
  buttons, 24px high), /taxonomy/film-genres (the colour picker, 20px, and
  the item rows, 24px high) and a taxonomy item (the breadcrumb links, 24px
  high). They are left for their own task.
- Typecheck clean; lint 0 errors and 75 warnings as on main; deadcode
  clean; `scripts/qa/test-local.py` 272 files, 3,021 of 3,021 passed.
