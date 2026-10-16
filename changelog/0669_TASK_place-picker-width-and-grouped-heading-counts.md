# Task 0669: Long place names no longer widen a form, and section counts group thousands

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0667
**Blocks**: None

## Overview

SLN-820 and SLN-827.

- **SLN-820:** with the place picker open on a 320px phone, a long place name widened the publisher editor and the person editor past the screen, so the page scrolled sideways. In WebKit at 320 the form reached 498px on a 314px screen; Chromium and Firefox did the same at 320 and 390. A fieldset sizes itself to the narrowest width of its content, and a truncated row's narrowest width is its whole text.
- **SLN-827:** `SectionHeading` printed its count as is, so a large one read "Not in Durtal (1107)". Every other count in the app groups its thousands.

## Implementation Details

- `src/components/shared/place-picker.tsx`: the results list takes `[contain:inline-size]`, so its width comes from the form and not from its rows. Long names truncate inside the list, as they were meant to.
- `src/components/shared/place-picker.tsx`, after review: rows no longer truncate. Each name wraps in full (`[overflow-wrap:anywhere]`), with its icon on the first line's cap height through `CapAligned`, so two Paris arrondissements read apart even in a narrow list.
- `src/components/authors/author-form.tsx`, after review: Birth Place and Death Place stack below 640px. Side by side at 320, each results list was about 120px wide.
- `src/components/shared/section-heading.tsx`: the count goes through `toLocaleString("en")`, as in `filter-dropdown.tsx` and `format.ts`. It keeps the no-break space and `whitespace-nowrap` from #407 (SLN-835), so "(1,107)" still stays with the title's last word.

## Completion Notes

- **Tests:** `ui/place-picker-busy.test.ts` pins the list's class, and `ui/section-heading-wrap.test.ts` checks "Not in Durtal (1,107)" and "Books (0)", each with the no-break space before the count. After #407 and #417 landed the change was rebuilt on main and checked again: the picker results, audits and page weight below all held.
- **Browser checks** on the seeded production preview, with twelve places named like "Paris 1 Arrondissement Saint-Germain-des-Prés Quartier Latin" and "par" typed in the picker. In Chromium, Firefox and WebKit, at 320 and 390:
  - The publisher editor's form ends 16px inside the screen (304 of 320, 298 of 314 in WebKit), and the page does not scroll sideways.
  - In the Edit person dialog, Birth Place, the dialog keeps to the screen and nothing in it scrolls sideways.
- **Audits:** the alignment and design audits found nothing on a publishing house's page and its edit page and on a person's page, at 1440 and 390, in all three engines.
- **Page weight:** every route is within budget.
- `pnpm typecheck` is clean, ESLint on the changed files is clean, and `pnpm test` passes. One unrelated e-book upload test timed out once under the full run and passes alone.
- **After review**, with the rows wrapping: in the Edit person dialog (both pickers) and the publisher editor, at 320, 390 and 1440 in Chromium, Firefox and WebKit, no result is cut, nothing scrolls sideways, and the two place pickers stack at 320 and 390 and sit side by side at 1440. The alignment audit, run with the results open, found nothing.
