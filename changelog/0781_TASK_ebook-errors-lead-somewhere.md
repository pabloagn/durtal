# Task 0781: E-book errors lead somewhere

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0639
**Blocks**: None

## Overview

SLN-864, from the review of #419. A mistyped e-book address that is not an id
(`/ebooks/not-a-book`) got a bare, unstyled "Invalid eBook id" text page from
the proxy. On the reader's error screen Escape did nothing and focus started
on the page body. A damaged e-book with no other file still led with Read,
which opens the file known to fail. Now:

- `/ebooks/<anything>` that is not an e-book shows "eBook not found" with
  Back to eBooks, as `/reader/<anything>` already did. API routes keep their
  400.
- On the reader's error screen focus starts on the first action, and one
  Escape asks "Leave the book?" as on an open book; a second Escape stays.
- When the only file is damaged, Replace file… leads as the primary button
  and Read follows as a secondary one, so the file can still be tried again.
  The notice beside the cover then just says the file is damaged.

## Implementation Details

- `src/proxy.ts`: the refusal is gone. The e-book layout and page already
  check the id before any query and answer `notFound()`.
- `reader-view.tsx`: the Escape that SLN-811 kept for "Opening the book" now
  also covers the error. An open that failed or timed out marks the input
  layer as gone (`inputListening`), which had made that Escape step aside for
  a layer that was no longer there.
- `open-error.tsx`: a client component that focuses its first action on
  mount, unless a dialog holds the focus.
- E-book page: `replaceLeads` when the target file has a recorded failure
  and there is no other file to read.

## Completion Notes

- Chromium, WebKit and Firefox at 1440 and 390:
  - `/ebooks/not-a-book`, `/ebooks/bad.id` and `/reader/not-a-book`: 404,
    "eBook not found", Back to eBooks leading to `/ebooks`.
  - The damaged EPUB in the reader: focus on Replace file…; Escape opens
    "Leave the book?" with Leave focused; a second Escape closes it and focus
    goes back to Replace file….
  - Its e-book page: Replace file… primary, Read secondary, "This EPUB file
    is damaged."
  - 0 alignment, design-audit, overflow and touch findings on every one.
- `page-weight.js` within budget.
- Tests: `library-proxy.test.ts` (mistyped addresses reach the page);
  `reader-view.test.ts` (focus on the error's first action, one Escape asks
  before leaving).
- `pnpm test` 6234 passed. No migration and no new packages.
