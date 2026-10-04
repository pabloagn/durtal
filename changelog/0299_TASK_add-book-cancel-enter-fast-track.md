# Task 0299: Add Book: Cancel on Every Step, Enter Runs Fast Track (SLN-437, SLN-438)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Two fixes from Joris on the Add book page (`/library/new`):

1. SLN-437. There was no way to leave the page without adding a book. The "Possible duplicate found" panel offered only "Add edition to this work" and "Create as new work". Every step now has a Cancel.
2. SLN-438. Enter on the Details step went to the next step (Edition details). Joris almost always uses Fast Track, so Enter now runs Fast Track.

## Implementation Details

The wizard is `src/app/library/new/wizard.tsx`.

- **Cancel**: one `cancelButton` (ghost), shown on all seven steps. On Search it sits at the right of the "Enter details manually" row; on the duplicate panel after its two choices; on the other steps beside Back. It goes back to the page the user came from (`router.back()`) only when that page is part of the app: the wizard was reached by an in-app link (the document was loaded at another address), or the document was loaded from one of our pages (same-origin referrer). Otherwise (a new tab, a bookmark, a link from another site) it goes to `/library`, so Cancel never leaves Durtal. In a step's footer it keeps beside Back when the row wraps on a phone; the duplicate panel's row wraps too. Nothing is saved before Fast Track or "Add to catalogue", so leaving saves nothing. It is disabled while a save runs.
- **Enter**: on Details, Fast Track carries `data-shortcut="next"`, so Enter in a one-line field presses it (the shortcut rules in `src/lib/shortcuts/shortcuts.ts`). Its tooltip shows the key. "Edition details" takes Enter only when Fast Track is not shown (a book added to an existing work). When the title or the author is empty, Fast Track is disabled and Enter does nothing, as for any disabled shortcut button. Enter keeps its normal behaviour in the description box (a new line) and in open pickers (it picks). ⌘Enter is unchanged: Fast Track on Details, "Add to catalogue" at the end.
- **Focus**: the Title field takes the focus when Details opens, so Enter works right after a search result is picked.
- **Docs**: the shortcut sheet's Enter row reads "Pick, confirm, next step, Fast Track" (`src/lib/shortcuts/shortcuts.ts`); `docs/04_ROUTES_AND_VIEWS.md` says what Enter does on Details and adds Fast Track and Cancel to the Add Book section.

## Completion Notes

- Browser check on a disposable copy of the live data, in Chrome, Firefox 157 and Safari, with real key presses; 11 of 11 pass in each:
  - Cancel after an in-app link goes back to that page; opened directly it goes to `/library`; reached from another origin (with that origin as referrer) it goes to this app's `/library`, never back.
  - The duplicate panel has one Cancel; at 390px its buttons wrap, with no sideways scroll, and Cancel leaves.
  - At 390 and 1440px, Cancel sits 8px after Back on Back's line, and the forward buttons end at the row's right edge.
  - Details: the title has the focus; Enter in the description adds a line; Enter in a one-line field runs Fast Track. A search result picked with ↓ and Enter, then Enter again, runs Fast Track.
  - Edition, copies, categorize and review: one Cancel each on Back's line; Cancel saves nothing (no link to the cancelled book in a search that finds the Fast Track book).
  - The shortcut sheet's Enter row fits on one line.
- Alignment and contrast audit on `/library/new` at 1440, 768 and 390px (Chrome): 0 issues.
- `pnpm typecheck` clean; `pnpm lint` 0 errors, warnings as on main; `pnpm test` and the full suite 1,630 of 1,630 (before the review fixes; CI runs them again).
- Page weight: `/library/new` 37 KB of 400. `/library` is over its 300 KB budget on main too (SLN-381), not from this change.
