# Task 1138: Marks beside an emoji save

**Status**: Completed
**Created**: 2026-10-20
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1494. A highlight, note or quote made near an emoji (or any character
outside the Basic Multilingual Plane) could fail to save. The reader cut the
quote and its context to 64 UTF-16 units with `.slice`, so a cut that fell
inside a surrogate pair left a lone surrogate in the locator. The stored
locator schema refuses text that is not well formed, and the reader then
showed a generic failure, or a validation dump, with no way to retry.

## Implementation Details

- `src/lib/reader/engines/foliate/quote-match.ts`: `headOf(text, limit)` and
  `tailOf(text, limit)` cut on grapheme boundaries (`Intl.Segmenter`), so an
  emoji, a family sequence or a flag is kept whole or left out; without
  `Intl.Segmenter` they never split a surrogate pair.
- `locator.ts`: the quote, its context on each side, the selection's
  highlight and the chapter and page labels use them in place of `.slice`.
- `pdf-geometry.ts` and `engine.ts`: the PDF quote and context, and the
  labels the engine passes on, are cut the same way.
- `src/lib/reader/mark-failure.ts`: `markFailureMessage` turns a refused mark
  into one sentence. The schema's own "Select at most ..." limit passes
  through; any other validation error reads "This mark couldn't be saved."
  instead of the raw issue list. `use-reader-annotations.tsx` uses it.
- `reader-tracking.tsx`: a refused quote shows the server's reason through
  `refusalMessage`.

## Completion Notes

`src/__tests__/reader/locator-emoji-cuts.test.ts` cuts at every place in a
paragraph holding a moon, a family and a flag, for `quoteAt`,
`quoteFromSelection` and the PDF locator, and checks that no lone surrogate
remains and that the stored locator schema accepts each result. It fails on
the old locator and passes now. The reader and reading suites (218 files)
pass; typecheck is clean.

Saving in a browser in all three engines was not run: the container's disk
is full, so this change relies on the unit tests and CI.
