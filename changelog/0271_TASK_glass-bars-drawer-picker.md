# Task 0271: Glass on the phone navigation, the drawer, the reader's bars and films' picker

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0236 (the glass material), 0270 (stacked on it: the last stray blurs)
**Blocks**: None

## Overview
The follow-up to 0236, from Pablo's note on a subtle, controlled glass. The phone navigation bar, the sidebar (a drawer over the page on a phone) and the reader's toolbar and progress bar each drew their own blur over a translucent fill; the drawer's backdrop was a flat 70% dim; films' search picker was an opaque panel with a large shadow. They now use the one material, so every surface that floats above the page, or is fixed over it, looks the same.

## Implementation Details
- `src/components/layout/mobile-nav-bar.tsx`, `src/components/layout/sidebar.tsx`: `bg-secondary/80` with `backdrop-blur-xl` becomes `glass-bar`, keeping the border on the side that faces the page. The material sits on a `::before` layer, so the drawer no longer traps `position: fixed` children the way a blur on the element did.
- `src/components/layout/shell.tsx`: the layer behind the open drawer is `glass-veil` (it was `bg-primary` at 70%), like the layer behind a dialog.
- `src/components/reader/reader-toolbar.tsx`, `src/components/reader/reader-progress-bar.tsx`: `bg-primary/90` with `backdrop-blur-sm` becomes `glass-bar`.
- `src/components/catalogue/search-picker.tsx` (films' people and company picker): `glass` instead of `bg-secondary` and `shadow-lg`.
- `src/__tests__/glass-surfaces.test.ts`: a new check fails on any `backdrop-blur` utility in the app. Blur belongs to the glass material only.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Glass, where it goes).

## Completion Notes
Measured on `scripts/qa/preview-local.py` (2026-10-04 backup), headless Chrome, 1440x900 and 390x844. Text contrast on glass is read from the screen: the surface's text hidden, the lightest pixel under each text against its color (`design-audit.js` cannot see through glass).

| Surface | Before (`main`) | After | Lowest text contrast after |
|---|---|---|---|
| Phone navigation bar, over the library grid | `bg-secondary` at 80%, `blur(24px)` on the bar | `glass-bar` | 11.39:1 (11.34:1 before) |
| Sidebar, desktop | the same | `glass-bar` | 5.09:1 (5.09:1 before) |
| Drawer on a phone, over the library grid | the same | `glass-bar` | 5.0:1 |
| Behind the open drawer | `bg-primary` at 70% | `glass-veil` (62%, 6px blur) | |
| Films' search picker, `/films/new` | opaque `bg-secondary`, `shadow-lg` | `glass` | 4.96:1 at both widths |

- The bars and the picker have no background or blur of their own; their `::before` carries the material (`rgba(10,13,16,0.88)`, `blur(24px) saturate(1.5) brightness(0.3)`).
- The reader's toolbar and progress bar need a Calibre library, which the preview does not have; they take the same `glass-bar` class as the navigation bar.
- `scripts/qa/alignment-audit.js`: 0 rows over 0.5px on `/library` (drawer open on a phone) and `/films/new` (picker open), at both widths. `scripts/qa/design-audit.js`: 0 low-contrast texts, 0 nested controls on `/`, `/library` and `/films/new`.
- The new blur check in `glass-surfaces.test.ts` fails on `main` (8 elements with `backdrop-blur`) and passes here, with 0270 merged in.
- `scripts/qa/page-weight.js`: 9 of 10 routes pass; `/library` is over its budget on `main` too, a separate task.
- `pnpm typecheck`, `pnpm lint` (0 errors) and `python3 scripts/qa/test-local.py` (1,612 tests) pass.
