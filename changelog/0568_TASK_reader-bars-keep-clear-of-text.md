# Task 0568: The reader's bars keep clear of the text; the chapter stays beside the line

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0501, 0517
**Blocks**: None

## Overview

What 0517 left of SLN-663. When the bars showed, the bottom bar covered the
last line of a page on desktop and about a line and a half on phones, and the
top bar the first line on phones; PDF and comic pages ran under both. In
scrolled books, PDFs and comics, where no running lines name the chapter,
nothing said which chapter you were in once the bars hid.

## Implementation Details

- `setInsets({ top, bottom })` on the engine (`src/lib/reader/engine.ts`,
  `engines/foliate/engine.ts`). The reader view measures both bars, as it
  already did for the speech player, and passes their heights before the
  book opens and whenever they change. With the speech player open the book
  already ends above it, so the bottom inset is 0 there.
- Paginated text: the paginator's top and bottom margins are 48px or the bar
  there, whichever is taller. The running lines stay in those margins, so the
  bars cover only them, never the text.
- Scrolled text, PDFs and comics: the book view is padded by the two bars, so
  pages fit and scroll between them.
- The bottom bar's second row (scrubber, Go to, Header and footer) keeps its
  height before the book's positions are ready, so the room kept for the bar
  is the same from the first page and the text never reflows when the
  scrubber appears.
- `ReaderBottomBar` takes `quietChapter`. Where no running lines name the
  chapter (relocation `paginated` is false), the chapter stays at the bottom
  while the bars are hidden, in the same place and type as the bar's own
  chapter (its size and `fg-secondary`), and crossfades with the bar (150 ms, none
  with reduced motion). It is hidden from assistive technology, which reads
  the chapter in the bar.

## Completion Notes

- New `clear` check in `scripts/qa/reader-engine-check.mjs`: with the bars
  up, the EPUB 3's text and the text PDF's pages stay between them, at 1440
  and at 390 with touch. Before this change 8 of its 12 rows fail in
  Chromium, WebKit and Firefox (the last line at 846 under a bar from 831 at
  1440, 789 under 751 at 390; PDF pages 0 to 900); with it all 12 pass.
- Measured in all three browsers at 1440, 390 and 320 for the EPUB 3, a
  scrolled EPUB 2, the text PDF and the comic, bars up and hidden: text and
  pages stay between the bars, and the quiet chapter in scrolled books sits
  at the bar's own chapter position to the pixel (840 to 860 at 1440, 764 to
  784 at 390).
- Alignment, design and overflow audits are clean on those four books with
  the bars up and hidden, in all three browsers at 1440, 390 and 320 (72 of
  72). `page-weight.js` passes (/reader 26 of 400 KB).
- Tests: `reader-progress-line.test.ts` (the quiet chapter shows only while
  the bars are hidden and only where no running lines name the chapter; the
  bar's second row is laid out before the positions are ready).
- The reader checks `opens`, `place`, `touch`, `bars`, `pointer` and
  `pdfmarks` pass. `navigation` and `dialogs` fail the same way on the build
  before this change in this container, and the 1440 `place` row is SLN-696.
- Not covered: scrolled text and PDFs now stop short of the bars instead of
  running under them, so a hidden-bars screen shows an empty band top and
  bottom; paginated books keep their running lines in those bands.
- No migration and no new packages.
