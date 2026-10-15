# Task 0634: One Escape while the book opens

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-811, from the review of #361. While "Opening the book" showed, the first
Escape did nothing in all three browsers; only a second press opened "Leave
the book?", so Escape then Enter during loading did nothing. Now one Escape
opens the prompt while the book opens, as after it is ready, and Enter then
leaves.

## Implementation Details

- Cause: the input layer starts listening only once the reader's features
  are ready and the engine's code has loaded, and the page's own code takes
  a moment to run after "Opening the book" first shows. An Escape in either
  gap was lost.
- `src/app/reader/[ebookId]/reader-view.tsx`: while the book opens and the
  input layer is not yet listening, a key listener takes Escape and runs the
  reader's own Escape, which asks before leaving. Once the input layer
  listens it hands over, so one press never opens two prompts.
- `src/lib/reader/early-escape.ts` (new) and
  `src/app/reader/[ebookId]/page.tsx`: a small inline script, with the page's
  nonce like the first-range prefetch, notes an Escape pressed before the
  reader's code runs. The reader takes it when it starts and asks then.

## Completion Notes

- Chromium, WebKit and Firefox at 1440, with the book's file held back so
  "Opening the book" stays: one Escape opens "Leave the book?" on a
  browser's first open (the device-id page), on a press made before the
  page's code runs and on a press after it; Enter then leaves to the
  e-book's page. Escape twice stays, the book then opens, and once it is
  ready one Escape opens the prompt as before. On main the first press did
  nothing in all three.
- `src/components/reader/device-handshake.tsx`: a browser's first open goes
  through the device-id page, which reloads into the book. It now asks on
  Escape too, and its reload waits while the question is up.
- 0 alignment and design-audit findings on the reader (EPUB and PDF) and on
  the device-id page with the prompt open, in all three engines at 1440, 390
  and 320; `page-weight.js` within budget.
- Tests: `controller-barrier.test.ts` presses Escape while the reader's
  features are still starting: one prompt, a second Escape closes it, and
  after the book is ready one Escape opens one prompt and Leave leaves. A
  second case presses Escape before the reader mounts. `early-escape.test.ts`
  covers the script. The first fails without the fix.
- No migration and no new packages.
