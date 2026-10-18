# Task 0789: The reader's first request tries again by itself

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-911, from the Third reviewer's offline survey of 16 Oct (section 6). On a
flaky connection, one dropped `POST /api/reader/device` (the device handshake
of a browser's first reader visit, SLN-668) showed "This eBook could not be
opened. Durtal could not be reached. Check the connection, then retry." with
Retry and Back, in all three browsers. Retry recovered.

## Implementation Details

- `src/components/reader/device-handshake.tsx`: a failed handshake is asked
  again by itself after 0.5 s, then after 1.5 s more (`HANDSHAKE_RETRY_MS`).
  Only when all three fail does the error show. A browser that does not keep
  the cookie is not retried: asking again cannot help, and neither is a
  request that hung for its whole 15 s (`TimeoutError`, or `AbortError` in
  WebKit), so a hung connection still shows the error after about 15 s, not
  three times that. Leaving the page stops the waits.
- When the error shows, a "Leave the book?" still up is cleared, so Try again
  starts afresh (from review).
- `src/components/reader/open-error.tsx`: the button is "Try again", as the
  house error views name it, here and where the reader's file failed to load.
  The two messages end "then try again."

## Completion Notes

- `reader/device-handshake-retry.test.ts`: one dropped request, then the book
  opens with no error; the waits are 0.5 s and 1.5 s; after three failures the
  error shows with Try again, which starts over and recovers; nothing is asked
  once the page is gone; a hung request (both names) shows the error at once,
  without asking again; Try again does not bring back a "Leave the book?" the
  error replaced.
- `reader/reader-view.test.ts`: the reader's own error offers "Try again".
- Production build on the preview database (`--seed-reader`), a fresh browser
  with `POST /api/reader/device` aborted: one or two drops open the book with
  no error; three show the error with Try again, which recovers. Same in
  Chromium, Firefox and WebKit.
- 0 alignment and contrast findings and no sideways overflow on the error at
  1440 and 390 in all three engines; page weight within budget on every route.
- No migration and no new packages.
