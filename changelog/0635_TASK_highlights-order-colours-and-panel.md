# Task 0635: Highlights in book order, colours you can tell apart, and the panel

**Status**: In Progress
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-682, from the e-book review of 13 Oct, the parts that need no migration.
The panel's "Book order" and the export now follow the text, the five
highlight colours can be told apart on every theme, quotes say so, a long note
is cut at six lines, and a comic's panel offers only bookmarks and says why.

## Implementation Details

- Order: `src/lib/reader/book-order.ts` (new) compares two places by
  section, then by CFI, then by progression. A mark's progression is only as
  fine as the page it was made on, so marks on one page came out in id order.
  It reads a CFI's steps and offset itself, since only the engine adapter may
  use foliate-js. `annotation-panel.ts` and `export.ts` use it.
- Colours: `annotation-colors.ts` has five hues a fifth of the colour circle
  apart at fill opacity 0.42 (was 0.24), deep enough on the dark page that
  reading and link text keep 4.5:1 over them. `themes.ts` has the light
  versions for Sepia and Light. The quote is a neutral grey, apart from every
  colour (it was the same as slate). `decorations.ts` and `pdf-decorations.ts`
  draw highlights at the palette's opacity.
  - Measured in OKLab, where about 0.02 is a just-noticeable difference: the
    old fills were 0.008 to 0.011 apart on the dark page; the new ones are at
    least 0.067 apart on dark and about 0.037 on Sepia and Light, and each is
    at least 0.04 from the page. `annotation-colors.test.ts` checks this per
    theme.
- Panel (`annotations-panel.tsx`): a note over 300 letters is cut at six
  lines, and the mark's menu offers "Show the full note" and "Show less"; a
  quote's line starts "Quote". With `imagesOnly` (a CBZ) the panel is titled
  Bookmarks, shows only bookmarks, and says a comic's pages are pictures, so
  they cannot be highlighted. The bar's button says Bookmarks there too.

## Completion Notes

- Chromium, WebKit and Firefox at 1440, with five marks made last to first,
  four of them on one page and one in the chapter before: the panel lists
  them in reading order. The four on one page share one stored progression
  (0.678), so main's order put them by id. That run used foliate-js's CFI
  comparison; `book-order.test.ts` sorts the same four CFIs with the
  comparison as committed. The marks draw in their new fills at 0.42 on
  Dark, Sepia and Light.
- The long note is cut at six lines (192px) at 1440, 390 and 320 in all three
  engines; "Show the full note" shows all of it and the menu then offers
  "Show less". The quote's line reads "Quote · 67% · date".
- The comic opens a Bookmarks panel with the sentence and no tabs, in all
  three engines at 1440, 390 and 320.
- 0 alignment, design-audit and overflow findings on the open panel, its
  expanded note and the comic's panel, in all three engines at 1440, 390 and
  320. The panel's Close icon was already on the title's cap height.
- Light themes: link text over a mark measures 3.34:1 on Sepia and 3.59:1 on
  Light (3.64:1 and 4.12:1 over today's paler marks). Sepia's link colour is
  already 3.86:1 on the bare page, so that theme's links fall short with or
  without a mark.
- From the review (the Sixth reviewer's fix, applied as sent): the fills are
  drawn above the text, so they now blend with the page instead of covering
  it (`markInk()` in `themes.ts`: lighten on the dark page, multiply at 0.5 on
  the light ones, in EPUBs and PDFs), and reading text keeps 4.5:1 inside
  every mark on Dark, Sepia and Light (`annotation-colors.test.ts`). A row's
  menu offers "Show the full passage" or "Show the full note" only when its
  clamp actually cuts some text, measured as the menu opens, and "Show less"
  once expanded; a comic's filter field is named Filter bookmarks.
- Not done here: the note dialog showing the passage and making a mark only
  when saved; merging a repeated mark; stopping a selection at the page edge;
  one toolbar design for new and existing marks; sending a delete when the
  page hides. Refusing duplicates in the database needs a migration.
- No migration and no new packages.
