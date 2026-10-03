# Task 0199: Cards without a photo show their subject, not an empty box

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0198
**Blocks**: None

## Overview

SLN-396. A card with no image showed a dark box with one letter in `text-fg-muted/30` (about 1.1:1, nearly invisible). 261 of 407 authors with books have no portrait, none of the 49 places has a photo, and 77 of 84 series have no book in the catalogue, so these grids looked empty. Each kind now shows something of its own: an author's books, a place's street, a series' shelf.

## Implementation Details

- `src/components/shared/no-photo.tsx`, one family on the dark card color with a faint tint (`color-mix` into `bg-secondary`, so `fg-secondary` text stays above 4.5:1):
  - `CoverFan`: up to three book covers, fanned (one cover 52% wide, two 46%, three 42%, rotated up to 8°), with a shadow, fading in with `FadeImage`.
  - `Monogram`: the initials in EB Garamond 46px on a tint picked from the name (six muted accents).
  - `PlacePlate`: the venue kind and city in small capitals, a rule, the street in the serif ("Online" for a venue with no address); tinted by the venue type's badge color, or the venue's own color when it has one.
  - `ShelfSpines`: one spine per known volume (three when unknown, at most twelve), heights fixed per series, on a shelf line.
- `getAuthorCoverPreviews` (`src/lib/actions/authors.ts`): one query for up to three covers per author (highest rated first, then earliest; the active poster, else the first edition's cover). About 40 ms for 48 authors. Used by `/authors` and by the dashboard's recent authors, only for authors with no portrait.
- `src/lib/utils/address.ts`: `cityFromAddress` and `streetFromAddress` read the city and the street from a one-line address ("Spui 14-16, 1012 XA Amsterdam, Netherlands" → "Amsterdam", "Spui"). The places' own records carry no city. Tests: `src/__tests__/utils/address.test.ts`.
- Cards: `AuthorCard` (`coverPreviews` prop), the dashboard's recent authors, `VenueCard`, `SeriesCard`. The venue photo, when there is one, uses `FadeImage`.
- `docs/03_DESIGN_LANGUAGE.md`: "Cards without a photo".

## Completion Notes

Measured on the dev server at 1440x900:

- Placeholder text contrast (canvas-resolved tint, WCAG ratio): `/places` 96 texts, lowest 4.58:1 (caption on the blue "Online Store" tint; the label tint went from 16% to 12% to pass); `/authors` 32 monograms, lowest 3.82:1 (46px text, limit 3:1).
- All 46 venue addresses give a city ("Amsterdam") and a street ("Singel", "Spui", "Leliegracht", …).
- `scripts/qa/alignment-audit.js`: no deviations on `/authors`, `/places`, `/series` and the dashboard. Cards of one kind keep one height on each.
- Dashboard: of the 12 recent authors, 10 show their own books (one cover or a fan) and 2 show their portrait (before: 10 letters at 1.1:1 on black).
- `pnpm typecheck`, eslint on the changed files and the full test suite (898 tests) pass.
- During verification the dev server went stale (it served the old tint). I restarted it with a fresh Turbopack cache and measured again.
