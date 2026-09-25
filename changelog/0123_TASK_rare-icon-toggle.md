# Task 0123: Rare flag icon toggle

**Status**: In Progress
**Created**: 2026-09-25
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0122
**Blocks**: None

## Overview

SLN-315 correction: replace the category-based hunting form with a boolean rare flag and a compact icon beside the rating.

## Implementation Details

- Gem icon toggles immediately. Marking sets local today; clicking again clears the flag/date. No modal or textual category badges.
- Marked date opens a 240px-wide portal popup with date input, save, today and close controls. Outside click/Escape dismiss; placement stays inside the viewport and avoids hero overflow clipping.
- Library grid/list/table show the gem with an accessible tooltip containing the date. Rarity filter selects the boolean flag.
- Corrective Drizzle migration 0024 converts both previous labels to true, preserves dates, drops the text field and enforces boolean/date consistency. Applied 0023 remains immutable.

## Completion Notes

Tested with disposable PostgreSQL including conversion of both legacy labels and an unmarked record, date preservation, one-click save/clear, validation and filtering. Browser checks cover historical date editing, on/off toggles, keyboard dismissal, and popup fit at 640×360 and 400×300 (115px tall, no internal scrolling). Live activation follows these checks under the user's explicit migration authorization.
