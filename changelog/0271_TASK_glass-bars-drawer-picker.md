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
SUMMARY
