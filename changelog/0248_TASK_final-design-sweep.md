# Task 0248: Final design sweep

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
The last part of the app-wide design pass. Every page was audited at 1440px and 390px with the alignment audit from #26, the design audit, a horizontal-overflow check and a visual pass. This task fixes what fell short and does not clash with an open PR.

## Implementation Details
- `src/app/recommenders/[id]/page.tsx`, `src/app/series/[id]/page.tsx`: the title-row actions sit on the title's cap height through `CapAlignedControls` (they were 12.01px and 5.35px off).
- `src/app/library/import/page.tsx`: the icon tiles beside "Python ingestion scripts" and "Import history" sit on the heading's cap height (9.69px off before). The icons are 16px and `fg-secondary` (they were 20px, over the icon maximum, and `fg-muted`).
- `src/app/harmonize/harmonize.css`: the rose dot after "Harmonize" uses `accent-rose-text` (`accent-rose` is 2.6:1, under 3:1 even at 46px); the eyebrow separators, step numbers and section counts use `fg-secondary`. 7 low-contrast texts before, 0 after.
- `src/components/ui/button.tsx`: button labels never wrap (`whitespace-nowrap`); a narrow header wraps whole buttons instead. At 390px "Add Publisher", "Publisher names" and "Add Series" broke onto two lines and their icons sat 10.09px off.
- `src/components/ui/select.tsx`: a select's label keeps one line and ends with an ellipsis when the trigger is narrow (the tooltip shows it whole); its chevron is `fg-secondary`. On `/settings/display` at 390px, "48 per page" wrapped out of the 32px trigger (11.82px off, 9 selects).
- `src/app/provenance/provenance-shell.tsx`: the four stat tiles take one column under 480px; at 390px "€1,247.77" was wider than half the screen and was cut.
- `src/components/taxonomy/taxonomy-tree.tsx`: the drag context has a fixed `id`, so the server and the browser agree on `aria-describedby`; the taxonomy pages logged a hydration mismatch on every row.

## Completion Notes
`scripts/qa/preview-local.py` (2026-10-03 backup), headless Chrome, 36 pages (every route, with one record of each detail page), against the live app before:

| | Before (1440 / 390px) | After (1440 / 390px) |
|---|---|---|
| Pages with an alignment row over 0.5px | 6 / 6 | 2 / 1, both fixed in #26 (book and author title rows) |
| Low-contrast texts | 7 on `/harmonize` / 3 | 0 / 0 |
| Pages with horizontal overflow | 0 / 0 | 0 / 0 |
| Console errors | a hydration mismatch on `/taxonomy/*` | none |

Left as they are, each for the PR that owns those lines:
- Book and author title rows: fixed in #26.
- "Export > Export", a button inside a menu trigger on the book and author pages (design audit, nested controls): the menu trigger becomes a real button in #4.
- The card action menu triggers, cover chips and dialog over-image colours: #4, #14, #16 (listed in #28).
- The phone layout of the shell, sidebar and detail headers: #11.
- `/settings/reader` shows its sample text at the reader's own size (18px by default), outside the seven sizes on purpose: it previews the reader.

`pnpm typecheck` and `pnpm lint` pass; the full `python3 scripts/qa/test-local.py` result is in the PR.
