# Task 0564: A saved place that starts after a line wrap reopens on its screen

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0501
**Blocks**: None

## Overview

SLN-676 reopen check. Since 8eae423e the reader saves the first visible point
of the screen, which fixed screens that start on an image or a chapter's first
line. In Chromium a screen that starts mid-paragraph still reopened one screen
early: there the screen's first point is the space a line wrap leaves at the
end of the previous line.

## Implementation Details

- `src/vendor/foliate-js/paginator.js`: `uncollapse` turns a collapsed point
  into a one-character range the paginator scrolls to. For a point before
  white space it now takes the next glyph instead. The wrapped space has no
  width and its only box sits in the previous column, so scrolling to it went
  one page back. When the space ends its text node, because the next word
  starts an inline element (italics, a link, a note mark), it walks on to the
  next glyph, or anchors on an image (or svg, video, canvas, iframe, hr) met
  first, so a screen that starts on an illustration is never skipped. A point
  inside a word or on an element is unchanged. `uncollapse` is exported for its test. VENDORED.md entry 25.
- `scripts/qa/reader-engine-check.mjs`: the `place` check gains three rows at
  768: a screen that starts on an image, on a chapter's first line, and
  mid-paragraph each reopens on that same screen (same saved CFI). In
  Chromium the mid-paragraph row turns until the screen starts on a wrapped
  space. Each row starts from the book's first page.

## Completion Notes

- On main the Chromium mid-paragraph row fails (left at p. 8, reopened at
  pp. 6-7); with this change it passes. The image and chapter rows pass on
  both, in Chromium, WebKit and Firefox.
- New `paginator-uncollapse.test.ts`: a point before a space moves to the next
  glyph, one inside a word stays, a space that ends its text node moves on to
  the next glyph or image, and element points are as before.
- Review: a wrap space just before an inline element still reopened one
  screen early (Chromium 768, the text after the space in a `<span>` landed
  on p. 7, not p. 8). The reviewer's fix walks past the text node, with two
  unit tests (before `<em>`, before `<img>`). Their sweep of every screen in
  three books at 768 and 390 reopened 273 of 273 in place in Chromium,
  Firefox and WebKit.
- The 1440 "same first words" row, already on main, fails on main and here
  alike in all three browsers: in two-page spreads, a place in a chapter
  that began on a right-hand page reopens one page back. That is SLN-696.
- No migration and no new packages.
