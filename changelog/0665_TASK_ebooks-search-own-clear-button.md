# Task 0665: The eBooks search clears with the app's own button

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0661
**Blocks**: None

## Overview

SLN-789. Typing in the eBooks search field showed the browser's own clear button: a bright white mark in Chromium, a grey tab in WebKit. It clashed with the dark, muted design.

## Implementation Details

- `src/app/(catalogue)/ebooks/ebooks-filters.tsx`:
  - The field keeps `type="search"`, and the browser's own clear button is hidden (`::-webkit-search-cancel-button` gets `display: none`; WebKit ignored `appearance: none`). Firefox draws none.
  - The library's search field has no clear control, so a new one was added: a Lucide X, 14px to match the search glyph on the left, with "Clear search" as its `aria-label` and tooltip.
    - It shows only while the field has text.
    - It is as tall as the field (32px, 44px on touch). Its X sits 12px in from the right edge, as the search glyph sits 12px in from the left, and the text stops before it.
    - It is `fg-secondary`, `fg-primary` on hover.
  - Clearing empties the field, makes the list busy, cancels a search still waiting on the typing pause, and searches for everything at once. The filters, sort and page size stay; the page resets. Focus goes back to the field.
  - The typing pause and the navigation now share one `send` function.
- No migration and no new package.

## Completion Notes

- **Test** (`ui/ebooks-search-draft.test.ts`): the button carries its label and tooltip and no `title`; clearing empties the field and focuses it, sends one search without the query (the pending draft's search never runs), and keeps the filters; an empty field shows no button.
- **Browser checks** in Chromium, Firefox and WebKit at 1440 and 390 (390 with touch):
  - With our button hidden, the brightest pixel in the field's right end is 9 of 255 (the field's own dark fill) in every engine. With the hiding rule removed, Chromium's mark reaches 255 and WebKit's 152, so the check sees them.
  - The X's center is on the field's center (0px off), and its inset (12px) equals the search glyph's.
  - Clicking (or tapping) clears the field, keeps the format filter and leaves focus in the field. Tab from the field reaches the button, and Enter clears.
- **Audits:** the alignment and design audits found nothing on `/ebooks` and `/ebooks?q=the` at 1440 and 390, in all three engines.
- **Page weight:** every route is within budget (`/ebooks` 214 of 250 KB).
- `pnpm typecheck` is clean. ESLint adds no warning; the one left in `ebooks-filters.tsx` was there before.
