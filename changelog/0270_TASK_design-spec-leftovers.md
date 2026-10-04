# Task 0270: The last overlays, blurs and icons the design spec rules out

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Fix
**Depends On**: 0235 (SLN-395), 0233 (SLN-403)
**Blocks**: None

## Overview
SLN-395 and SLN-403 were marked Done with parts left. The spec says controls over an image use the palette's overlay tokens, never black or white; blur belongs to the glass only; interface icons are 16px at most. Four places still used black and white over images, two surfaces of page content still blurred, and the lightbox drew its icons at 20 and 24px. SLN-403 asked for a 28px author portrait in the command palette, and the initials of the SLN-396 placeholder on the tint taken from the name.

## Implementation Details
- Card actions menu on book and author cards (`books/book-card-actions-menu.tsx`, `authors/author-card-actions-menu.tsx`): the trigger was `bg-black/60 text-white` with a blur; it is `bg-overlay text-fg-primary` with the cover chip's hairline border, and `bg-tertiary` on hover.
- Film still (`app/films/[slug]/page.tsx`) and publisher banner (`app/publishers/[slug]/page.tsx`): `bg-black/70` becomes `bg-scrim`, as on the book, author and collection pages.
- Dashboard stat tiles (`app/page.tsx`): `Card glass` drew page content with an 8px blur; the tiles are opaque `bg-secondary` like every other card. Nothing else used the `glass` prop or the `glass-subtle` utility, so both are gone (`ui/card.tsx`, `globals.css`).
- Reader format chips (`app/reader/reader-library.tsx`): a blurred `bg-primary/80` pill becomes the cover chip (`COVER_CHIP`, `COVER_CORNER.topRight`), so they share the size, inset and backdrop of the marks on a book card.
- Lightboxes: in the gallery's (`media/lightbox.tsx`) the close and previous/next icons are 16px (they were 20 and 24px), and the backdrop is `scrim-deep` like the cover lightbox (it was `bg-primary` at 95%). In both (`shared/image-lightbox.tsx` too) the buttons are `fg-secondary` (they were `fg-muted`, under 3:1 for a control), and the close button is 28px like the image adjustment button beside it, so their centers line up (they were 2px apart in the cover lightbox and 4px in the gallery's).
- Command palette (`layout/command-palette.tsx`): an author's portrait is 28px square, centered on the 36px row a book's 24x36 cover sets, so every row keeps one height; it shows the upper part of the portrait. With no picture, the initials sit on `monogramTint(name)`, the SLN-396 tint, in `fg-primary`: at 12px, `fg-secondary` on the tint was 4.21:1. The thumbnail ring uses `glass-border` instead of white.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Over images), `docs/04_ROUTES_AND_VIEWS.md` (Command Palette).

## Completion Notes
Measured on `scripts/qa/preview-local.py` (2026-10-04 backup), headless Chrome, 1440x900 and 390x844. The backup has no film, no publisher banner and no Calibre library, so a film with a still and a publisher banner were added to the disposable preview database only.

| Surface | Before | After |
|---|---|---|
| Card actions trigger (`/library`, `/authors`) | `rgba(0,0,0,0.6)`, white icon, 8px blur | `rgba(3,5,7,0.85)`, `fg-primary`, no blur, 16px icon |
| Film still, publisher banner | `rgba(0,0,0,0.7)` | `rgba(3,5,7,0.7)` (`bg-scrim`) |
| Dashboard stat tiles | 1-3% wash with an 8px blur | `bg-secondary` (`rgb(10,13,16)`), no blur |
| Lightbox icons (gallery) | 20px close, 24px previous/next, `fg-muted` | 16px, `fg-secondary` |
| Lightbox top buttons | close and adjust centers 2px (cover) and 4px (gallery) apart | 0px |
| Palette author portrait | 24x36 | 28x28, rows 48px like the book rows, text centered on the picture (0px) |
| Palette initials | `fg-secondary` on `bg-tertiary`, no tint | name tint (`color-mix` of the accent at 18%), `fg-primary` |

- No element on the dashboard, `/library` or `/authors` has a blur, a black background or white text outside the glass.
- `scripts/qa/alignment-audit.js`: 0 rows over 0.5px on `/`, `/library`, `/authors`, the film and publisher pages, `/reader` and with the palette open, at both widths. `scripts/qa/design-audit.js`: 0 low-contrast texts and 0 nested controls on all of them (the palette initials were 4.21:1 in `fg-secondary`, now in `fg-primary`).
- The reader's format chips use the cover chip classes; with no Calibre library in the preview, they were not rendered.
- `scripts/qa/page-weight.js`: 9 of 10 routes pass; `/library` is over its budget on `main` too, a separate task.
- `pnpm typecheck`, `pnpm lint` (0 errors) and `python3 scripts/qa/test-local.py` (1,611 tests) pass.
