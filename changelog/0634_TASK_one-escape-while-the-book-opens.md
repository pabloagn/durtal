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

- Pending browser checks.
- Tests: `controller-barrier.test.ts` presses Escape while the reader's
  features are still starting: one prompt, a second Escape closes it, and
  after the book is ready one Escape opens one prompt and Leave leaves. A
  second case presses Escape before the reader mounts. `early-escape.test.ts`
  covers the script. The first fails without the fix.
- No migration and no new packages.
