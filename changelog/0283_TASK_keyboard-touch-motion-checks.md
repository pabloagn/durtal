# Task 0283: Keyboard, Touch and Reduced-Motion Checks

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0263, 0265, 0267
**Blocks**: None

## Overview

SLN-380, the checks task 0267 left open: keyboard paths, dialog focus return, reduced motion and touch. A new audit measures them with real key presses and touch emulation, and this task fixes what it found on the collection pages, the dashboard and a book page.

## Implementation Details

- `scripts/qa/interaction-audit.mjs` (headless Chrome over the DevTools protocol, no dependency). For each route:
  - **Keyboard:** Tab walks the page; every stop must be visible and look different with focus than without (measured with transitions off). No positive `tabindex`. Each menu opens with Enter, takes focus, moves with ArrowDown and closes with Escape, focus back on its button.
  - **Dialogs:** every button and menu item that opens a dialog (it skips the ones that delete, save, submit or toggle): focus moves in, 25 Tabs stay inside, Escape closes it, focus goes back to the opener (the menu's button for a menu item). A keyboard tooltip on the focused control may take the first Escape, as the tooltip rule says.
  - **Motion:** with `prefers-reduced-motion: reduce`, no element on the page, in an open menu or in an open dialog has an animation or transition that moves (transform, scale, translate, rotate) or loops.
  - **Touch:** at 390px with touch emulation (coarse pointer, no hover): no control is hidden until hover; every control is at least 24px or spaced as WCAG 2.5.8 allows (a 24px circle on its center touches no other control); links in running text are exempt. Controls under the design's 44px are counted, not failed.
- Fixes:
  - `src/styles/globals.css`: under reduced motion every animation and transition ends at once (0.01ms, one iteration), so the dialog's scale-in, the sidebar's slide and the chevrons' turn no longer move. Events still fire.
  - `src/components/catalogue/curation.tsx`: the rating stars are 24px wide on a touch screen (`pointer-coarse:w-6`); they were 20px buttons side by side. Desktop is unchanged.
  - The controls that show on hover always show on a touch screen. Before, they were invisible there but still took taps. On the book and collection cards (copy, actions, poster adjustment) one new utility, `hover-reveal` (`globals.css`), replaces five classes per control, so `/library` and `/` send less HTML; in the media manager (image select and delete) `pointer-coarse:opacity-100`.
- `docs/03_DESIGN_LANGUAGE.md`: a "Keyboard, touch and motion" section with these rules and the audit; the book card rule names the touch exception.

## Completion Notes

Disposable restore of the rollback drill's dump (one perfume, film and painting added through their forms), `next dev`. Routes: the three collection homes, the three add pages, the three detail pages, `/` and a book page.

- **Before** (main's code, same audit): 79 failures on 11 routes.
  - Motion (31): the sidebar's width and slide transition on every page; the dialog scale-in in every edit dialog; chevron and cover transforms.
  - Touch (48): the five rating stars (20×20, side by side) on each collection detail page (15); on `/` and the book page, card controls that only show on hover (32); a recommender's 12px website icon on the book page (1). The audit now counts that icon as a link in running text, which WCAG 2.5.8 exempts.
  - Keyboard and dialogs: none. Every Tab stop shows focus; 5 dialogs on each collection detail page and 12 on the book page take focus, keep Tab inside, close on Escape and return focus.
- **After:** no failures on the 11 routes. On `/` the audit now sees 99 touch controls instead of 69, because the card controls show on a touch screen; all pass.
- `alignment-audit.js` and `design-audit.js` on the same 11 routes, plus `/library` and `/collections`, at 1440, 768 and 390 px: 0 deviations over 0.5px, 0 unnamed or nested controls, no horizontal scroll, no console errors. Low contrast: 0 on the collection pages; on `/` and `/library` only the faint initial of a book card without a cover (`CoverPlaceholder`, `fg-muted` at 30%), a decoration that is unchanged from main.
- Card controls, measured in headless Chrome on `/` and `/library`: with a mouse, opacity 0 until the card is hovered, then 1; with a touch screen, 1 at once (36 and 96 controls).
- `node scripts/qa/page-weight.js` on a disposable restore of the newest backup: `/library` 307 KB (313 on main), `/` 287 KB (290 on main); `/library` stays over its 300 KB budget, which is left to the page-speed work.
- `pnpm typecheck`, `pnpm lint`, `python3 scripts/qa/test-local.py`: pass (1,611 tests in 130 files, 0 skipped).

### Not changed

- **44px:** the design asks for 44px touch targets on a phone. Most controls are 24–44px (for example 22 of 25 on `/perfumes`); they pass WCAG 2.5.8 but not the 44px rule. Making every control 44px on a phone changes the phone layout of every page: a separate decision.
- **Responsive imagery:** wide, tall, square and missing images and long text at 390, 768 and 1440 px were checked for the painting pages in task 0267, not again here.
