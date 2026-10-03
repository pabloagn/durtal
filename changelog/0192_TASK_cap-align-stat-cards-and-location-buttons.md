# Task 0192: Cap-align the Provenance stat icons and the Locations buttons

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0190
**Blocks**: None

## Overview

SLN-392. The alignment audit found three icons beside text that were off the text's cap-height center: the book page year row (+0.61px), the Provenance stat cards (+8.38px) and the Locations card buttons (+0.61px). 518e441 fixed the year row. This task fixes the other two.

## Implementation Details

- `src/app/provenance/provenance-shell.tsx` (`StatCard`): the 34px icon tile sat at the top of the card, 8.38px below the label's cap-height center. A 34px tile cannot sit on a 12px label's line and also keep the card's 16px corner inset (centered, its top inset became 7.63px). The tile box is gone: the 16px icon sits on the label's cap-height center in `CapAligned`, with the label's type (`type-caption`). Same color, same 16px right inset, same card height (128px).
- `src/app/locations/location-card.tsx`: the edit and delete buttons beside the "N items" count sit in `CapAligned` (24px); the row carries the count's type (`font-mono text-xs`).
- `src/app/provenance/provenance-shell.tsx`: the pipeline `DndContext` has a fixed `id`. Without it, dnd-kit made a different `aria-describedby` id on the server and in the browser, and every load logged a hydration error.

## Completion Notes

Measured on the dev server at 1440x900:

- Provenance: the four stat icons sit 0.005px from the label's cap-height center (was +8.38px). `scripts/qa/alignment-audit.js`: 25 checked, no deviations.
- Locations: the 12 buttons sit 0.001px from the count's cap-height center against the layout baseline; gaps 8px (count to button, button to button). The audit script reads +0.50px here: for JetBrains Mono, the text box is 0.5px taller than the font's ascent plus descent, and the script takes the baseline from the text box. 15 checked, no deviations over 0.5px.
- Book page and author page: no deviations (30 and 24 checked).
- Provenance: no hydration error after reload; the cards open the order panel; the drag help text exists under the id the cards point to.
- `pnpm typecheck` and eslint on the changed files pass.
