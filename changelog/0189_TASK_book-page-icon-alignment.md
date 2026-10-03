# Task 0189: Book page icon alignment

**Status**: Completed
**Created**: 2026-10-03
**Priority**: LOW
**Type**: Fix
**Depends On**: SLN-389 (type scale)
**Blocks**: None

## Overview
The alignment audit (`scripts/qa/alignment-audit.js`) found icons on the book page more than 0.5px off the cap-height center of their text: the rating star and the rare and anathema mark icons (0.61px, SLN-392), and the two comment box icons (-0.52px). The year row centered boxes with `items-center`, not the text.

## Implementation Details
- `src/app/library/[slug]/page.tsx`: the year, rating, marks and links row carries the year's type (`font-mono text-xs`) and aligns to the top; the star and the Marks group sit in `CapAligned`. `py-1` keeps the row 28px tall, so the page spacing does not change.
- `src/components/books/book-links.tsx`: the Goodreads and StoryGraph links sit in `CapAligned` (they appear only in that row).
- The comment box needed no change here: SLN-389 moved its text from 13px to 14px, which brings its icons to -0.41px. `CapAligned` measured -0.49px there, so the simpler layout stays.

## Completion Notes
- Measured after SLN-389 (one type scale) on a book with a rating, marks and a Goodreads link: the star, the mark icons and the link box are 0.11px from the year's cap-height center (were 0.61px). Comment box icons: -0.41px. Alignment audit: no issues. Design audit: no low-contrast text; the two nested and unnamed controls it lists are the Export and action menus, not changed here.
- Row height (28px) and the gaps above (8px) and below (12px) are the same as before.
