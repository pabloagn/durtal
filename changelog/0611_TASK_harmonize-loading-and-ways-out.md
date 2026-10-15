# Task 0611: Harmonize loads in its own layout; empty views lead out with a button

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0609
**Blocks**: None

## Overview

From the loading, empty and error states audit of 15 October
(`findings/audit-loading-2026-10-15.md`, findings 4 to 7).

- **"No books found" led out with plain-looking text.** The way out of an
  empty search ("Clear search", "Clear filters", "Go to first page") was a
  ghost link that read as plain text, as the not-found views' did (task 0609).
- **The eBook library's empty state was a line of text.** "No eBooks yet." was
  a lone heading, with no mark and no way to upload. A search that matched
  nothing showed a text link.
- **Harmonize's loading screen was not its page.** Its title sat 6.8 px lower
  than the page's in every browser and width. The eyebrow was shorter, and
  the title dot and the Scan control were missing. One big box stood where the
  tabs, the toolbar and the queue go.
- **Harmonize's failed scan offered "Clear filters".** That does nothing for a
  failed scan. "All in order" offered it too, with no filter set.

## Implementation Details

- **`src/components/shared/no-results.tsx`**: both views lead out with
  `buttonClass("secondary")`, the shared empty views' action look. This covers
  every list that uses them.
- **`src/app/(catalogue)/ebooks/ebooks-view.tsx`**: the shared views.
  - No eBooks at all: `EmptyState` with the eBooks mark and "Upload eBooks".
  - A search or filters that match nothing: `NoResults`, whose clear link
    keeps the page size as before.
  - A view with nothing in it, with no filter set: `EmptyState`.
- **`src/app/(catalogue)/harmonize/frame.tsx`** (new) holds what the page and
  its loading screen both draw: the categories' marks and notes, the busy
  `IconLabel`, the eyebrow and title, and a category card's content.
  `workspace.tsx` uses it.
- **`src/app/(catalogue)/harmonize/loading.tsx`** draws the page's own parts:
  - the header, with Scan library busy;
  - the four category cards, with "—" for their counts;
  - the tabs, and the toolbar's own controls, held;
  - then the workspace's box.
- **`workspace.tsx`**: the empty queue's action fits its view.
  - After a failed scan: Scan library, busy while it runs.
  - When filters hide findings: Clear filters.
  - When all is in order: nothing.

## Completion Notes

- Production preview, Chromium, Firefox and WebKit at 1440, 390 and 320:
  - Harmonize's loading screen and page: the title at 0.0 px in each.
  - The alignment, touch, design and layout audits report nothing on:
    - the empty searches of books, people and eBooks, and a page past the end;
    - the eBook library, empty;
    - Harmonize, with its scan and with the database failing;
    - Harmonize's loading screen.
- `src/__tests__/ui/loading-audit-states.test.ts` covers:
  - the secondary way out of `NoResults` and `PageOutOfRange`;
  - the eBook library's empty and no-results views;
  - Harmonize's loading screen;
  - the failed scan's Scan library.
- The error banner's dismiss button (Harmonize with the database failing)
  sat 2.5 px off the banner's first line and was 14 px on touch. It now sits
  on the line's cap height (`CapAligned`), 44 px on touch.
