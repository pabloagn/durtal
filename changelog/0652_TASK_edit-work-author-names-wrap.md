# Task 0652: Edit Work: author names wrap in full; Remove is 44px on touch

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0646, 0647
**Blocks**: None

## Overview

Review of #341. The book's Edit Work dialog (and the quick edit built on the
same form) cut an author's name beside its role menu and cross: "Joris-Karl
Huysmans" lost its end at 320 in all three engines, and a long name was cut
at every width. The row's Remove cross was 22px on touch. The record forms'
role chips already wrapped their names (0646, 0647).

## Implementation Details

- `work-form.tsx`, the author row:
  - The name wraps in full (`break-words`, no `truncate`).
  - With a mouse from `sm` up, the role menu and the cross stay beside the
    name, centered on its first line's cap height (`CapAligned`).
  - On touch, and below `sm`, the name takes a line of its own, with the
    menu and the cross under it, as a record form's role chip does.
  - On touch the menu and the cross are 44px (`coarseHeight={44}`,
    `pointer-coarse:size-11`).
- Test: `src/__tests__/ui/work-form-authors.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database, Edit Work
  opened with E then W on a book page. Chromium and WebKit at 1440, 640, 639,
  390 and 320 with a mouse and with touch below 800; Firefox with a mouse.
- No name is cut, with the real name and with a 90-letter one.
  - Beside the name, the menu's and the cross's centers sit on the name's
    cap-height center: 0.00px in Chromium and Firefox, 0.07px in WebKit.
  - On touch and below 640 they sit under the name, inside the row.
- On touch the menu is 44px tall and the cross 44 x 44.
- Alignment, touch and overflow audits are clean in every view.
- `page-weight.js` passes. Typecheck clean, lint clean. No migration, no new
  package.
