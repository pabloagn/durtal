# Task 0210: Slider grids follow their container width

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0202 (SLN-366 container map)
**Blocks**: None

## Overview
Every grid that takes its column count from the "Size" slider used fixed `grid-cols-N` classes, so a phone got the desktop column count. On `/library` at 390px, size 6 gave 6 columns of 34px and size 8 gave 8 columns of 21.75px: titles 0-8px wide, copy counts outside the cards.

The collection homes already had the fix (SLN-366): the grid sits in an `@container` and each slider value maps to container-query classes, so a card stays about 115px wide or more. This task moves that map to one module and uses it in all eight slider grids. It also fixes what the narrow cards then showed: filter rows wider than a phone, badges that push the title or the count out of a card, and long words cut at the card edge.

## Implementation Details
- `src/components/shared/grid-columns.ts`: the SLN-366 map, values unchanged (`2: grid-cols-2` up to `8: ... @5xl:grid-cols-8`). Used by `book-grid.tsx`, the authors, series, places, recommenders and publishers shells, `domain-home-shell.tsx` and `perfume-grid.tsx`. Each grid sits in `<div className="@container">`. The local `COL_CLASSES` maps are gone.
- Container queries, not viewport breakpoints: the sidebar collapses at 800px, so the content width does not grow with the viewport.
- `EntityFilters`: the wrapping row (search on its own line on a phone, sorts wrap) is the default, as `FILTER_ROW_CLASSES`. Series, recommenders and publishers get it; library uses it without the margin. Authors, the collection homes and perfumes passed the same string and now use the default. Places keeps its own variant.
- Cards under a width, measured with the card as the container:
  - Book card: under 160px the language badge is hidden, so year and count fit.
  - Publisher card (now `@container`): under 160px the country badge is hidden when an Imprint or Group badge is shown, and the website icon is hidden so "N editions" stays on one line (at 124px it wrapped and the icon sat 9.38px off). The publisher page keeps the link.
  - Venue card: under 220px the type badge is hidden, so the name has the row; the name gets `min-w-0`.
- `lines-1` and `lines-2` (`globals.css`) get `overflow-wrap: break-word`: a word wider than the card breaks and the clamp adds the ellipsis, instead of a cut at the edge. Text that fits does not change.
- Fixed elements: card menus are `absolute` in a `relative` card, dialogs use `showModal` and tooltips `popover`, so the `@container` wrapper (layout containment) moves none of them.

## Completion Notes
Measured in the browser pane (ratio 1) on this worktree's server (:3111) against the live server (:3100), all six list pages, slider values 2-8 each, view forced to grid. "Outside" counts text a reader sees outside its card; "cut" counts text cut sideways without an ellipsis.

| Width | Before | After |
|---|---|---|
| 390 | size 8: 8 cols of 21.75px; up to 131 texts outside cards (library); page overflow library 472px, publishers 272, recommenders 144, series 134, places up to 54 | every size: 2 cols of 135px; 0 outside; 0px overflow on all six pages |
| 768 | — | max 4 cols of 152.5px; 0 outside, 0 rows over padding, 0 cut |
| 1024 (sidebar open) | library: 8 cols of 79.25px, 42 outside, 12px overflow | max 5 cols of 136.4px; 0 outside, 0px overflow |
| 1440 | sizes 2-8 give 2-8 cols (544 to 124px) | the same 2-8 cols and widths; size 7/8 problems below are gone |

- 1440 before, sizes 7 and 8: library "0 copies" 3.6px into the card padding and 23.6px outside the card; places "Online Store" badge 1.6/21.6px over; publishers country text 1.39px wide on 4 cards. After: 0.
- Forced card widths 114, 124, 135, 144, 160, 170 and 220px (114px is the narrowest the map allows), six pages: before the card fixes, venue names were 0px wide at 114-144px and up to 115 cut texts (places); after, 0 outside, 0 over padding, 0 cut, except the street name on the photo-less place plate at 114px only (3px, `no-photo.tsx`, left alone: another session has uncommitted work there).
- Final run, headless Chrome for Testing (ratio 1, own profile), slider at 8, alignment audit from 0211 and design audit, six pages:

| Width | Cols x card | Page overflow | Text outside cards | Alignment issues (rows checked) | Low contrast / unnamed / nested |
|---|---|---|---|---|---|
| 390 | 2 x 132px | 0 | 0 | 0 (5-77) | 0 / 0 / 0 |
| 768 | 4 x 152.5px | 0 | 0 | 0 (7-83) | 0 / 0 / 0 |
| 1024 | 5 x 136.4px | 0 | 0 | 0 (23-98) | 0 / 0 / 0 |
| 1440 | 8 x 124px | 0 | 0 | 0 (25-98) | 0 / 0 / 0 |

- Design audit counts at 1440 (radii, icon sizes, strokes, colors) are the same before and after. The 1024px "+10.09px" icons on `/library` before were the audit probe bug fixed in 0211.
- Collection homes (`/perfumes`, `/films`, `/paintings`) answer 404 until each collection opens (`requireEnabledDomain`), so they were not measured. Their change is the import move and a class string equal to the new default.
- `pnpm typecheck` and `pnpm lint` pass.
