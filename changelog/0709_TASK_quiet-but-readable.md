# Task 0709: Quiet but readable: mark toggles, comment icons, placeholders and disabled controls reach their contrast (SLN-844)

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0708
**Blocks**: None

## Overview
The Fifth reviewer's contrast survey (`findings/contrast-survey-2026-10-15.md`, main 66f63b4f) found no needed text under AA. It did find these:
- two icon-only controls under 3:1;
- placeholders on surfaces lighter than the page just under 4.5:1;
- disabled controls at 1.4 to 2.2:1, with a disabled primary button's label all but gone.

Each one is a shared token or component. The fixes nudge the existing tokens and opacities and add no new colours.

## Implementation Details
- `fg-muted` goes from #727B83 to #7D868E (`src/styles/globals.css`). This is the placeholder and decoration token.
  - Contrast: 5.38:1 on bg-primary, 5.04:1 on bg-secondary and 4.54:1 on bg-tertiary (was 4.63, 4.33 and 3.90).
  - It stays a step below `fg-secondary` (#9BA4AD).
  - `scripts/qa/design-audit.js`, `scripts/qa/layout-audit.js` and docs/03's token table name the new value.
- The collections search takes `placeholder:text-fg-muted` like every other field. Before, it drew the browser's default placeholder at 3.63:1.
- The unmarked Rare and Anathema toggles (`mark-toggle.tsx`) drop their 70% tint and use `text-fg-muted`, at 5.38:1 (was 2.80). The comment box's paperclip and send icons (`comment-editor.tsx`) drop their 50% tint, at 5.30:1 (was 1.97).
- A disabled control is now the control at 60% opacity:
  - `action-control`, which covers every `Button`;
  - the pager (`pagination.tsx`, was 35%);
  - a Select's trigger (`select.tsx`, was 40%);
  - the carousel arrows (`horizontal-carousel.tsx`, was 30%). These also move from `fg-muted` to `fg-secondary`, like the other icon controls, so their disabled state reaches 3:1.
- docs/03, Contrast, states the rule.
- Test: `src/__tests__/ui/quiet-but-readable.test.ts`. It computes the placeholder token's contrast on the three surfaces from `globals.css`.

## Completion Notes
Rendered pixels on a production build in headless Chromium at 1440. Each figure is the glyph's core pixel against the control's ground:

| Control | Before (survey) | After |
|---|---|---|
| Disabled primary button ("Add film" on an empty form) | 1.51 | 4.65 |
| Pager's First on page 1 | 1.89 | 3.43 |
| Carousel's Scroll left at the start | 1.40 | 3.39 |
| Unmarked mark toggle | 2.80 | 5.38 |
| Comment box icons | 1.97 | 5.30 |
| Placeholders: collections, suggestions, palette | 3.63, 4.33, 4.36 | 5.38, 5.04, 5.22 |
| Disabled Select | 2.16 to 2.75 | 4.77 |

The survey composited a disabled control's label over its already-faded fill, so its before figures run lower than this method would give.

`design-audit.js` finds no low-contrast text and no unnamed controls in Chromium, Firefox and WebKit at 1440 and 390. Pages checked: a book, /collections, /films/new, /people, /settings/data, a film and /reading/suggestions. The alignment audit is clean on the same pages.
