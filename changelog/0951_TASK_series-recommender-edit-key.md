# Task 0951: Series and recommender pages show Edit with its key

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Every detail page shows an Edit button whose tooltip names its E-then-letter key, except a series and a recommender, where Edit sat only in the Actions menu. Their keys (E then S, E then R) worked, but nothing on the page showed them. Fixes SLN-967.

## Implementation Details

- `src/components/series/series-actions.tsx` and `src/app/(catalogue)/recommenders/[id]/recommender-actions.tsx`: the shared `DetailEditButton` ("Edit series", "Edit recommender", with `EDIT_KEYS`) sits before the Actions menu, as on a book, a person or a collection.
- The loading screens draw the wider controls: a series' block is 261px (285px on touch), with Add books at the default size beside the bordered Edit, and moves under the title below a 688px row, where a twenty-letter title already wraps it; a recommender's is 133px (157px on touch) and moves under the name below 480px.
- Test: `src/__tests__/ui/series-recommender-edit-key.test.ts`.

## Completion Notes

Checked on a production build in headless Chromium, Firefox and WebKit at 1440, 390 and 320: Edit shows its tooltip and keys, opens the editor, the controls keep 8px gaps, and the alignment audit finds no deviation. The loading screens' controls match the loaded page's position and width at 1440, 768, 430, 390 and 320, to 2px (Firefox and WebKit draw "Edit" 2px wider); a series title that wraps to two lines on a phone moves the controls down, which no loading screen can know. Page weight within budget. `pnpm test`: 6,753 passed.
