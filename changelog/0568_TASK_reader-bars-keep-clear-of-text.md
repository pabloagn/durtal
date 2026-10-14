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

- `setInsets({ top, bottom, pinned })` on the engine (`src/lib/reader/engine.ts`,
  `engines/foliate/engine.ts`). The reader view measures both bars, as it
  already did for the speech player, and passes their heights before the
  book opens and whenever they change, with whether the bars are kept
  visible. With the speech player open the book
  already ends above it, so the bottom inset is 0 there.
- Paginated text: the paginator's top and bottom margins are 48px or the bar
  there, whichever is taller. The running lines stay in those margins, so the
  bars cover only them, never the text.
- Scrolled text, PDFs and comics use the whole screen, under bars that come
  and go, as before. With "Keep the toolbars visible" on, the book view is
  padded by the two bars instead, so pages fit and scroll between them.
- Scrolled text with the bars free: the book's first line starts below the
  top bar and its last line ends above the bottom bar (a `data-durtal-edge-room`
  sheet pads the first and last linear sections), so neither screen is ever
  covered. Mid-book the bars pass over the text while they show.
- The bottom bar's second row (scrubber, Go to, Header and footer) keeps its
  height before the book's positions are ready, so the room kept for the bar
  is the same from the first page and the text never reflows when the
  scrubber appears.
- `ReaderBottomBar` takes `quiet` (the page's background and text colours).
  Where no running lines name the chapter (relocation `paginated` is false)
  and the bars are free, the chapter stays at the foot of the screen while
  the bars are hidden: centred in a slim band of the page's own colour, its
  text at the bar's chapter size in the page's text colour at 70%, with the page fading into the
  band over 24px, so no line is ever cut at a hard edge. It crossfades with
  the bar (150 ms, none with reduced motion) and is hidden from assistive
  technology, which reads the chapter in the bar. Scrolled text also fades
  into the top edge over 24px.

## Completion Notes

- `clear` check in `scripts/qa/reader-engine-check.mjs`: with the bars up the
  EPUB 3's text stays between them; the text PDF's pages stay between them
  with "Keep the toolbars visible" on, and with it off they are larger (at
  1440 they use the screen's height, 0 to 900). Before this change the EPUB 3
  rows fail in Chromium, WebKit and Firefox (the last line at 846 under a bar
  from 831 at 1440, 789 under 751 at 390); with it all rows pass.
- Review round: the first version kept the bars' room in scrolled text, PDFs
  and comics for good, which left empty bands with the bars hidden and a
  line cut at a hard edge. Now they use the whole screen unless the bars are
  kept visible, and the chapter sits in a slim faded band.
- Measured in Chromium at 390 and 1440, scrolled EPUB 2: the first line at
  73 below the top bar's 57 (68 below 49 at 1440); the band 776 to 844 at 390
  and 840 to 900 at 1440, its label centred; the top 24px fade. Dark, Light
  and Sepia pages each take their own colour.
- Reader checks `clear`, `bars`, `touch`, `opens` and `pdfmarks`: 160 of 160
  in Chromium, WebKit and Firefox.
- Alignment, design and overflow audits are clean on the EPUB 3 in pages,
  the text PDF, the comic and the scrolled EPUB 2 in all three page colours,
  bars hidden, in all three browsers at 1440, 390 and 320 (63 of 63).
  `page-weight.js` passes (/reader 25 of 400 KB).
- Tests: `reader-progress-line.test.ts` (the band shows only while the bars
  are hidden and takes the page's colours; the top fade; the bar's second
  row is laid out before the positions are ready).
- No migration and no new packages.
