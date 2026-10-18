# Task 0818: Shortcut keys for assistive technology

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

No control carried `aria-keyshortcuts`: the keys showed only in tooltips (`data-tooltip-keys`) and key caps, which assistive technology does not read as shortcuts. Source: the shortcuts survey, finding 3. Fixes SLN-964.

## Implementation Details

- `src/lib/shortcuts/shortcuts.ts`: `ariaKeyShortcuts(keys, mac)` turns the tooltip's key tokens into the attribute's form ("mod k" is "Meta+K" on a Mac and "Control+K" elsewhere, "alt left" is "Alt+ArrowLeft", "esc" is "Escape", "+" is "Plus"). A sequence ("e then w") is written as the app prints it, "E W"; the attribute has no notation of its own for a sequence. `shortcutProps(keys, mac)` returns both attributes, to spread on a control.
- Every control that set `data-tooltip-keys` (29 files) now spreads `shortcutProps`. The three with "mod" (the sidebar and phone bar Search buttons that open the palette, and the palette's Read action) pass `useIsMac()`.
- Each page search field that `/` focuses (`data-shortcut-search`) carries `aria-keyshortcuts="/"`.
- `docs/03_DESIGN_LANGUAGE.md`, Tooltips, and the tooltip layer's comment name `shortcutProps`.
- Test: `src/__tests__/ui/aria-keyshortcuts.test.ts` checks the helper for a leader sequence and modifier keys, and that no control sets `data-tooltip-keys` without it.

## Completion Notes

Checked on a production build in headless Chromium, Firefox and WebKit at 1440 and 390, on the dashboard, Books, a book page, eBooks, Organizations, a taxonomy page, People and Add a book: every control with tooltip keys carries the matching `aria-keyshortcuts`, and every page search field carries "/". Chromium's accessibility tree lists them (Search: Control+K; Search works: /; Dashboard: G D). With a Mac platform the palette buttons read Meta+K. Alignment audit: no deviations. Page weight within budget. `pnpm test`: 6,732 passed.
