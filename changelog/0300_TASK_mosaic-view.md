# Task 0300: Mosaic view

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview
SLN-439. Pablo: "a gorgeous mosaic of images without the cards", for any type of content with posters: collections, books, perfumes, people, films. Every list with posters now offers a Mosaic view beside its grid: the pictures alone, in justified rows, with the title on glass on hover.

## Implementation Details
- `src/components/shared/mosaic.tsx` (new): `Mosaic` takes items (link, title, subtitle, proportions, picture) and lays them out; `MosaicImage` draws a stored picture over its tone with its crop, or a stand-in; `mosaicPerRow` turns the size slider (2 to 8) into pictures per row (4 to 10).
- `src/styles/globals.css`: `mosaic`, `mosaic-tile`, `mosaic-tile-selected`, `mosaic-fill`. Justified rows in CSS alone: each tile's flex basis and growth follow its proportions (`--tile-aspect`), so the tiles of a row share one height and fill it; the filler takes the last row's free space. The row height comes from the container width (`cqw`) and the list's usual proportions, never under 150px.
- The view: `mosaic` in `ViewMode`, labelled "Mosaic" (`Images` icon) after Grid; the size slider shows for it too (`entity-filters.tsx`). A switcher without a list of modes still offers grid, list and detailed only.
- Lists: books (`library-view.tsx`; the view is kept in `durtal-view-mode`), people (`authors-shell.tsx`, a single added branch, with the portrait, else the fan of covers or the monogram), films, perfumes and paintings (`film-grid.tsx`, `perfume-grid.tsx`, `painting-grid.tsx`, with each kind's own poster; paintings in their own proportions), collections (new `collections-view.tsx`: the switcher and the size slider beside the search, and `durtal-collections-view-mode` and `durtal-collections-grid-columns` in `LIST_PREFERENCES`, so Settings → Display lists them too; the grid now follows the slider like the other lists). Selection works in the mosaic of books and people.
- Not changed: series (a strip of covers, not one poster), publishers (logos), recommenders and places (no pictures), the reader (no views yet).
- Tests: `src/__tests__/ui/mosaic.test.ts` (happy-dom).
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Mosaic), `docs/04_ROUTES_AND_VIEWS.md` (Library views).

## Completion Notes
Checked on a disposable preview (port 3474) with eight test films, perfumes and paintings, each with a book cover as poster; paintings in mixed proportions (landscape, portrait, square).

- Layout, measured in Chrome, Safari and Firefox at 1440, 1024 and 390px on all six lists: every full row fills the width (edge gap 0 to 0.05px); the tiles of a row share one height (spread 0.03px or less); gaps 4px between tiles and between rows; no sideways scroll. Books: 8 a row at 1440, 7 at 1024, 3 at 390.
- Hover (Chrome): the picture grows to 1.04, the caption glass shows the title and the author, the other tiles dim to 0.62. Keyboard focus shows the caption and the rose ring.
- `alignment-audit.js` and `design-audit.js` on all six lists at 1440 and 390: 0 deviations, 0 low contrast, 0 unnamed controls.
- `page-weight.js`: only `/library` is over (309 / 300 KB in grid view); live `main` serves 323 KB there, so the overage is older than this change. Server times over budget moved from route to route between runs (dev compiles).
- Safari and Firefox show no pictures on the preview: it has no storage keys. Their screenshots show the empty tiles in the same places.
- On a phone, a list of mixed proportions can leave one picture alone in a row; it then fills the width (paintings at 390px). This is how justified rows behave; books, films, perfumes and collections share one proportion and never do it.

Review fixes:
- The last row had the minimum height (150px) while full rows grew past it (175px on a phone, 1.5px more on a desktop). The row height now comes from the number of pictures that fit (`--mosaic-count`, the slider's count or fewer where a picture would be under 150px), so full rows fill the width at that height and the last row matches them. The count uses `tan(atan2(a, b))` for a division of lengths and `round(down, ...)`. Safari reads a container unit inside `tan()` and `atan2()` as 0 (one picture per row at 1440px in the first try), so the width goes through a registered property first (`@property --mosaic-width`, `<length>`), which turns `100cqw` into px.
- A lone portrait in a row (paintings on a phone) stopped about 36px short of the right edge: flexbox gives a line only part of its free space when the growth factors add up to under 1, and a tile grew by its proportions (0.8). Tiles now grow by 100 times their proportions, which shares the space the same way; the filler grows by 10^8, so the last row still keeps its height.
- Collections have the size slider, for the grid and the mosaic.
- A right-click on a tile did nothing. A clear layer over the picture now takes it, so the browser shows the link's menu (open in a new tab, copy the link), and the image guard still keeps "Save image" away, as on a card.
