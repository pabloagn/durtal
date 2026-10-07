# Task 0349: Small touch targets and titles cut without an ellipsis

**Status**: Completed
**Created**: 2026-10-07
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0347
**Blocks**: None

## Overview

SLN-517. Review of PR #128 and PR #129 found titles that were cut with no
ellipsis, and four controls smaller than 44 px on a touch screen at 390 px.

## Implementation Details

- **Titles.** Twelve `lines-1 block` pairs: `block` overrode the line clamp's
  `display: -webkit-box`, so the clamp never ran and a long title was cut
  without an ellipsis. `block` is gone at `book-picker.tsx` (2),
  `queue-list.tsx`, `hub-cards.tsx`, `import-client.tsx` (2),
  `reading-tiles.tsx` (4), `reading/page.tsx` and `reading/import/page.tsx`.
- **"See them"** on `/reading/stats` (`data-stats-pile-link`) takes
  `touch-hit`.
- **Switches.** `Switch` (`src/components/ui/switch.tsx`) takes `touch-hit`,
  so every switch grows to 44 px on a coarse pointer. The "Hide Anathema in
  suggestions" switch on `/settings/reading` is named by its row's label
  (`aria-labelledby`).
- **"Edit"** in the publisher header grows to 44 px on a coarse pointer
  (`pointer-coarse:h-11`), like the controls beside it.
- **Journal row titles.** The link takes `touch-hit` and the clamp moves to
  an inner span, so the link's touch area is not clipped by its own overflow.
- **Found by the check, same fix.** The Up Next titles (`queue-list.tsx`), the
  past imports' file names (`reading/import/page.tsx`) and the book titles of
  an import's preview (`import-client.tsx`, two) take the journal's pattern;
  "All imports" on an import's page takes `touch-hit`. They were 24 px tall
  on touch.

## Completion Notes

- On a production build with seeded readings and a real Goodreads import (the
  `import` journey passes), in headless Chrome, WebKit and Firefox:
  `touch-audit.js` at 390 px with a coarse pointer finds nothing on
  `/reading`, `/reading/next`, `/reading/journal`, `/reading/stats`,
  `/settings/reading`, `/settings/display`, `/reading/import`, a publisher
  page and an import's page; no `lines-1` element computes to `display:
  block`, and long titles are cut with an ellipsis; the alignment and design
  audits find nothing at 1440 and 390; every route is within its page
  budget.
- The Hide Anathema switch is named "Hide Anathema in suggestions" in
  Chrome's accessibility tree, and on touch its hit area is 44 by 44 px.
- `scripts/qa/test-local.py`: 239 files, 2,647 tests, all passed.
