# Task 0565: Jumps, PDF turns and comic turns keep the page until the next is ready

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0501, 0518
**Blocks**: None

## Overview

SLN-660 leftovers from 0501 and 0518: "a jump still fades in from blank",
and "the same turns for PDFs and comics". A jump (Go to, Contents, Back) to
a section that was not loaded hid the page, loaded the section and faded it
in from a blank screen. PDF and comic turns cut from one page to the next
with no slide or fade.

## Implementation Details

- New `src/vendor/foliate-js/page-hold.js`, `changeUnderHold(host, change,
  options)`: the page stays on screen until the next one is ready, then a
  jump fades it (180 ms) and a turn slides (250 ms) or fades (180 ms) it in
  its direction (right to left too). Instant turns and reduced motion swap at
  once; nothing moves when the page did not change; a hold lasts at most 3 s.
  - A View Transition takes the snapshot. Chromium and Firefox run no
    animation frames inside the update callback, and loading a section needs
    them, so there the snapshot is taken with an empty update and held by an
    endless animation while the page changes under it on the live new layer.
  - Only the book is held there (the outermost shadow host, named
    `foliate-hold`), with the reader's controls (`[data-reader-chrome]`,
    `match-element`) kept above it.
  - WebKit runs frames inside the update but keeps a held book's new layer
    blank, so it changes the page inside the update, waits three frames for
    it to paint, and holds the whole screen, fading turns too. Which engine
    this is, is found on the first hold. That first hold in WebKit has
    named the book: the name goes inside the update, so the new page is
    taken with the rest of the screen, and the held book fades (merge
    review: before, it swapped at once and could show the page blank while
    it loaded).
- `paginator.js`: `#goTo` runs a change to another section under the hold
  (patch 20's hide and fade-in stand down while it holds). Page turns into a
  section that is not loaded pass their direction. Same-section turns keep
  the paginator's own slide.
- `fixed-layout.js`: every turn and jump of a PDF or comic runs under the
  hold, and reads `animated` and `turn-style` as the paginator does
  (`turnAttributes` in `layout.ts`, set by `engine.ts` for pre-paginated
  books).
- VENDORED.md entry 26.
- `scripts/qa/reader-engine-check.mjs`: new `turns` check. It records every
  frame during Back from a far page of the EPUB 3, a turn of the text PDF and
  a turn of the comic, at 1440 and 390, and fails on a blank frame (below 15%
  of the first frame's variation over the book).
  - Chromium frames come from its screencast. WebKit frames are screenshots
    taken back to back, leaving out those taken while a transition's update
    runs: a screenshot paints the live page then, while the screen still
    shows the snapshot.
  - Both browsers can show one blank frame as a snapshot is taken, with the
    unchanged page on the frames either side. An empty transition on the
    same page did it too, in some runs. Such a lone frame is counted apart.
  - Firefox is not checked: headless Firefox captures leave out the View
    Transition layers.
  - The jump measured is Back, not Go to, because Go to keeps its dialog up
    over the page until the page opens.

## Completion Notes

- `turns` on main: the four jump rows fail in Chromium and WebKit (two to
  four blank frames, then the fade in from blank); the PDF and comic rows
  pass (they cut, with no blank frame). With this change all 12 rows pass,
  with one lone capture frame counted apart on each Chromium jump.
- New `page-hold.test.ts` (13 tests): the fallback without View
  Transitions, the book held for a jump, the four slide directions, an
  instant swap, no movement when nothing changed, a nested hold, the
  Chromium and WebKit orders, WebKit's first hold and later ones, and a
  failed change.
- Alignment, design and overflow audits are clean on the EPUB 3, the text
  PDF and the comic after a turn, in Chromium, WebKit and Firefox at 1440,
  390 and 320 (27 of 27).
- Not covered (the ticket stays open): the slide still needs a look in a
  real Firefox, whose headless captures show the layers blank. In WebKit,
  turns that load fade rather than slide.
- No migration and no new packages.
