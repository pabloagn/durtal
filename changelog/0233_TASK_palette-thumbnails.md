# Task 0233: Command palette results show covers and portraits

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0236 (glass; this branch is stacked on it)
**Blocks**: None

## Overview
SLN-403. The command palette is the most used way to move around the app, but its results were text lines with a generic book or person icon: "Fictions" and "Labyrinths" by Borges looked the same, and the palette showed nothing of the collection's look. Now each book result shows its cover and each author result the portrait (monochrome, like every author image), 24x36 like a small card, or the initials when there is none.

## Implementation Details
- `src/lib/actions/quick-search.ts`: each work result carries `cover` (the active poster's thumbnail, else the newest edition with a cover) and each author `photo` (the active portrait's thumbnail, else the legacy `photo_s3_key`). Both come from subqueries in the same two queries, so the palette makes no extra request.
- Relational-query `extras` render columns without their table; inside a subquery a bare `"id"` names the subquery's own row (`m.author_id = "id"` compared a media row with itself). The subqueries name the outer row explicitly (`"works"."id"`, `"authors"."id"`).
- `src/components/layout/command-palette.tsx`: `ResultThumb` in place of the Book and User icons: a fixed 24x36 box (2px corners, a faint ring), the image loaded lazily, or the initials in the serif.
- Docs: `docs/04_ROUTES_AND_VIEWS.md` (Command Palette).
- `src/__tests__/integration/quick-search.test.ts` (new): each book gets its own cover (active poster, else an edition's; an inactive poster never shows), each author the portrait, else the legacy photo, else none.

## Completion Notes
Measured on `scripts/qa/preview-local.py` (2026-10-03 backup, pictures from the live app's image endpoint), headless Chrome, 1440x900.

| Query | Results | With a picture | Row heights | Time to first result |
|---|---|---|---|---|
| borges | 4 | 3 | 48px | 211ms |
| dostoevsky | 8 | 8 | 48px | 184ms |
| kafka | 5 | 5 | 48px | 193ms |
| woolf | 5 | 3 | 48px | 187ms |

- Every result's text sits on its picture's vertical center (0.00px). `scripts/qa/alignment-audit.js` with the palette open: 0 issues (32 rows checked).
- Time to first result on the live app before (other database, over the network): 230-308ms. The two new subqueries take 0.15ms for 8 books in the preview database (`EXPLAIN ANALYZE`).
- Before the fix above, the first preview run showed initials for Borges, who has a portrait.
- `pnpm typecheck`, `pnpm lint` and `python3 scripts/qa/test-local.py`: see the PR.
