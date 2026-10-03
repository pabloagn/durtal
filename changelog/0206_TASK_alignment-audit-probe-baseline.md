# Task 0206: Alignment audit measures the layout baseline

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
`scripts/qa/alignment-audit.js` put the text baseline at the top of the first character's range box plus the canvas `fontBoundingBoxAscent`. On a Retina screen (device pixel ratio 2) Chrome rounds font ascent and descent in device pixels, but canvas rounds them in CSS pixels. For JetBrains Mono at 14px the range box is 18.5px tall (14.5 + 4) and the canvas metrics give 18px (14 + 4). The audit put the baseline 0.5px too high and reported +0.50px for the location card buttons, which are 0.001px off.

## Implementation Details
- `firstLine()` now reads the layout baseline from a probe: a zero-height inline-block (`all:unset`, 1px wide with a -1px right margin, so the text does not move) inserted right after the first character, in the same line. Its bottom is the baseline. Cap center = baseline - `actualBoundingBoxAscent` / 2, as before.
- Text directly in a flex, grid or `-webkit-box` box lays out in an anonymous item. A probe there would become its own item, so the run of text nodes goes into an `all:unset` wrapper for the measurement.
- The DOM is restored: the text node is split for the probe and joined again, so React keeps the same node objects.
- `firstLine()` returns null for a zero-size range box (Next keeps a hidden copy of a page after client navigation).
- The rest of the script and its output do not change.

## Completion Notes
Measured on the dev server (:3100) at 1440x900 with the old and the new script, in headless Chrome for Testing at device pixel ratio 1 and 2 (`--force-device-scale-factor`; CDP emulation of the ratio does not change font rounding). 389 rows per ratio.

- Ratio 1 (the Claude browser pane): every row has the same offset with both scripts. The probe ascent equals the canvas ascent for Inter, the serif face and JetBrains Mono at 12–38px.
- Ratio 2: the probe ascent differs from the canvas ascent by 0.5px in 21 of 27 font and size pairs. So sans and serif rows move too, not only mono:

| Page | Rows | Ratio 1: changed rows | Ratio 2: old → new, by font |
|---|---|---|---|
| / | 29 | 0 of 29 | sans 16px (15): -0.18 → +0.32; serif 21px (4): +0.50 → 0.00; serif 30px (6): 0.00 → 0.00; serif 38px (4): 0.00 → 0.00 |
| /library | 27 | 0 of 27 | mono 14px (6): +0.50 → 0.00; sans 14px (6): -0.50…-0.41 → 0.00…+0.09; sans 16px (15): -0.18 → +0.32 |
| /library/i-by-wolfgang-hilbig | 30 | 0 of 30 | sans 14px (15): -0.49…+0.23 → +0.01…+0.73; sans 16px (15): -0.18 → +0.32 |
| /authors/jorge-luis-borges | 24 | 0 of 24 | mono 14px (6): +0.50 → 0.00; sans 14px (3): -0.41 → +0.09; sans 16px (15): -0.18 → +0.32 |
| /publishers | 98 | 0 of 98 | mono 12px (24): +0.38 → +0.38; mono 14px (6): +0.50 → 0.00; sans 14px (5): -0.50…-0.41 → 0.00…+0.09; sans 16px (15): -0.18 → +0.32; serif 21px (48): +0.50 → 0.00 |
| /places | 71 | 0 of 71 | mono 14px (6): +0.50 → 0.00; sans 14px (50): -0.50…-0.41 → 0.00…+0.09; sans 16px (15): -0.18 → +0.32 |
| /provenance | 25 | 0 of 25 | mono 12px (4): +0.01 → +0.01; mono 14px (6): +0.50 → 0.00; sans 16px (15): -0.18 → +0.32 |
| /locations | 15 | 0 of 15 | sans 16px (15): -0.18 → +0.32 |
| /collections | 30 | 0 of 30 | mono 14px (6): +0.50 → 0.00; sans 16px (15): -0.18 → +0.32; serif 21px (9): +0.50 → 0.00 |
| /taxonomy | 25 | 0 of 25 | sans 16px (15): -0.18 → +0.32; serif 21px (10): +0.50 → 0.00 |
| /settings | 15 | 0 of 15 | sans 16px (15): -0.18 → +0.32 |

- Location card buttons (direct check, ratio 2): range box 18.5px; old +0.501px, new +0.001px. At ratio 1 both give +0.001px.
- Probe checks over all 778 rows: the icon never moved while the probe was in place, and the probe was always on the first character's line. The flex wrapper was used for 12 rows. After a run, the page HTML and all text nodes (same objects, same data) are unchanged.
- Rows over 0.5px with the new script (not fixed here): `/library/i-by-wolfgang-hilbig`, the Claude website link icon beside "Claude" (14px sans), +0.73px at ratio 2 and +0.72px at ratio 1. The old script reported it only at ratio 1.
- Not covered: the script walks up 4 levels from an icon to find its row. The location card buttons are 5 levels below their row, so the audit does not check them; the direct check above does.
