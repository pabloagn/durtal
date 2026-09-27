# Task 0150: Pixel-perfect icon alignment and an alignment audit

**Status**: Completed
**Created**: 2026-09-27
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0148
**Blocks**: None

## Overview

SLN-342: icons beside text sat off the text's optical center, most visibly beside serif text (the Shoah collection icon was 3.13px low). Every icon now sits on the cap-height center of the text beside it, and a browser audit measures this. Pixel-perfect alignment is now a standing rule in `CLAUDE.md`.

## Implementation Details

- Cause: `items-center` centers an icon on the line box; EB Garamond's capitals sit well above it.
- `CapAligned` (`src/components/shared/cap-aligned.tsx`): centers a fixed-height box on the cap height of the first text line beside it. An inline-block with `overflow: hidden` takes its baseline from its bottom margin edge; negative block margins of half its height move that edge to its center and keep the box from stretching the line; `vertical-align: 0.5cap` raises the center to the cap-height center. Works for any font, size and line height; the row carries the text's type.
- Applied: collection card icon, collection header icon, carousel scroll arrows, dashboard section icons, dialog header buttons (all dialogs), publisher favourite star, taxonomy family icon tile, activity dots (time now on the description's baseline). The list toolbar's sort arrow uses the same math inline (`align-[calc(0.5cap-6px)]`).
- Focus rings inside aligned boxes are inset, because the box clips.
- `scripts/qa/alignment-audit.js`: run in the page; lists every icon (≤ 48px) more than 0.5px off the cap-height center of the text beside it. An icon beside a compact stack of about its height (a number over a label) is checked against the stack's center; icons inside large tiles or not on the text's line are skipped.
- `CLAUDE.md`: an "Always" rule to run the audit on every page a front-end change touches, and alignment rules under Design Language.

## Completion Notes

- Technique measured in Chrome: 0.00–0.02px off for serif and sans text of 13–46px, boxes of 14–44px, several line heights.
- Before (live): Shoah +3.13px, carousel arrows +2.69, dashboard headings +2.64, collection header +4.65, dialog close +17.31, publisher star −5.36, sort arrow +1.26, activity +0.67, taxonomy tiles off the first line.
- After (local copy of live data): audit clean on the dashboard, library, a book page, authors, collections, a collection page, series, publishers, recommenders, places and taxonomy, and with the add-to-collection dialog, the mark hover card and the icon picker open. Collection card icons 0.00px, collection header 0.01px.
- Typecheck, lint and unit tests pass.
