# Task 0253: Edit menu (E) on the book page

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: SLN-409 (keyboard shortcuts, on main)
**Blocks**: None

## Overview

SLN-421. On the book page, `E` opened Edit Work and `T` opened Edit
Taxonomy at once, and Manage Media had no key. `E` now opens an Edit menu,
like the Add (`A`), Go to (`G`) and Copy (`Y`) menus: `E W` edits the work,
`E M` opens the media manager, `E T` edits the taxonomy. A plain `E` or `T`
no longer opens a dialog.

## Implementation Details

- `src/lib/shortcuts/shortcuts.ts`: `EDIT_KEYS` (`w`, `m`, `t`),
  `SHORTCUTS.editMenu` (`e`), an "Edit this page" line in the Menus group
  and an "Edit" group (`then: true`) for the sheet and `/settings/shortcuts`.
- `src/components/shortcuts/shortcuts-provider.tsx`: `useEditActions` lets a
  page give its edit actions; the provider keeps them in a ref, like the copy
  entries. `E` opens the Edit menu (`LeaderMenu`) only while the page has
  edit actions; elsewhere `E` does nothing. Same rules as the other menus: no
  key fires while typing, in a dialog or in the reader; `Esc` or a click
  outside closes the menu.
- `src/app/library/[slug]/work-actions-menu.tsx`: registers Work, Media and
  Taxonomy with `useEditActions` in place of the two `useShortcut` calls; the
  actions menu shows "E W", "E M" and "E T".
- `src/components/layout/command-palette.tsx`: the page's edit actions show
  under "This page" ("Edit work", `E then W`).
- Docs: `docs/04_ROUTES_AND_VIEWS.md` (Shell shortcuts, palette groups, book
  page).

## Completion Notes

No schema or route change. New test:
`src/__tests__/utils/edit-menu-shortcuts.test.ts`. `useShortcut` stays for
single page keys; no page uses it now.

Checks: typecheck, lint, `pnpm test` and the full DB suite
(`scripts/qa/test-local.py`, 1491 tests) pass. On `next dev` at 1440×900,
book page: `E` opens the Edit menu; `E W`, `E M`, `E T` open Edit Work,
Manage media and Edit taxonomy; plain `T` and `W` open nothing; `E` on an
author page opens nothing; typing "edit" in the palette field opens no menu
and lists the three edit entries. `alignment-audit.js` with the Edit menu
open, with each dialog open and with the shortcuts sheet open: no
deviation. `design-audit.js`: no low-contrast or unnamed controls.
