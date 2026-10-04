# Task 0232: Title-row controls on the cap height; the audit sees them

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-416, SLN-412 and the selection bar's "Exit selection" icon. `scripts/qa/alignment-audit.js` missed some icons: its walk stopped 4 levels above an icon, an icon beside a bare text node was skipped, and a title row's buttons were checked against a neighbouring button's label instead of the title. So the buttons beside the book and author titles sat 5.35px above the title's cap-height center with the audit reporting 0 issues. On `/library` in selection mode, "1 selected" and "Select all" wrapped onto two lines, the bar grew to 71px and the close icon sat 12.34px off.

## Implementation Details
- `scripts/qa/alignment-audit.js`: the walk looks up to 8 levels for the text row (`MAX_DEPTH`); with a bare text node, the text marks the icon's column (`outerBox(svg, holder ?? text)`); a second pass checks every icon control beside an `h1`-`h3` (a title row's buttons and menu triggers, not text buttons) against the heading's cap-height center.
- `src/app/library/[slug]/page.tsx`, `src/app/authors/[slug]/author-detail-header.tsx`: the title-row controls go in `CapAlignedControls` (`height={32}`, the title's type), as on the perfume page. The menus they open keep the body type and are not clipped.
- `src/components/books/bulk-action-toolbar.tsx`, `src/components/authors/author-bulk-action-toolbar.tsx`: the count, "Select all" and "Deselect" never wrap, so the bar keeps one line; the close icon is `fg-secondary` (it was `fg-muted`, under 3:1 for a control).

## Completion Notes
Measured on `scripts/qa/preview-local.py` (2026-10-03 backup), headless Chrome.

| | Before (live app) | After |
|---|---|---|
| Book page title buttons (`/library/i-by-wolfgang-hilbig`) | -5.35px | 0.01px (0.00 at ratio 2) |
| Author page actions (`/authors/jorge-luis-borges`) | -5.35px | 0.01px (0.00 at ratio 2) |
| Selection bar on `/library` | 71px tall, close icon 12.34px off | 50px, 0.00px |
| Rows the audit checks (old, new script), 1440px | `/` 29, 37 · `/library/i-by-wolfgang-hilbig` 30, 45 · `/locations` 15, 28 · `/publishers` 97, 148 · `/settings` 21, 28 | |

- The new audit on the 11 pages of SLN-416 (`/`, `/library`, a book, an author, `/publishers`, `/places`, `/provenance`, `/locations`, `/collections`, `/taxonomy`, `/settings`) at 1440 and 1024px, ratio 1, and at 1440px, ratio 2 (`--force-device-scale-factor=2`): 0 rows over 0.5px after the fixes. On the live app before, it found the book title buttons (3 rows) and the author actions (1 row), which the old script missed.
- Found and left for a separate task: the list views (`/library` and `/authors` in list view) have rows whose actions are centered on the two-line row rather than the title's first line. The old audit already reported 53 such rows on `/library`; the new one reports 101 there and 96 on `/authors`. And on `/publishers` at 390px the page header's two buttons wrap (10.09px), which is the phone layout's (#11).
- `pnpm typecheck` and `pnpm lint` pass; the full `python3 scripts/qa/test-local.py` result is in the PR.
