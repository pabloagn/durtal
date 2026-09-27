# Task 0148: Cards of one kind always share one height

**Status**: Completed
**Created**: 2026-09-27
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-339: cards of one kind had different heights (a title on two lines added a line), and the badges on book covers had different sizes and insets. Now every card of a kind has the same height in every grid and row, whatever its text, and every cover badge shares one size and inset.

## Implementation Details

- `lines-1` / `lines-2` utilities (`src/styles/globals.css`): text clamped to exactly one or two lines and always that tall, so optional or short text keeps its space.
- Applied to the book, author, collection, series, publisher, recommender, place and taxonomy family cards, the dashboard author and wanted cards, the collection page member cards, and the captions under row cards.
- Collection cards use the book card layout (2-line name with its icon, 1 line of description, info row with the edition count), so both are the same height on a book page. The edition count moved from the cover into the info row.
- `src/components/books/cover-chip.ts`: one chip style for every cover indicator (status, rating, priority, rare, anathema, digital edition): 16px (20px on wide cards) tall, same border, background and radius, 4px (8px) from the corner. Status and rating color only their text.

## Completion Notes

Measured on a local copy of live data at 1400px: one height per card kind on every page (book page rows 382.8px including collections; library 398.8; authors 454.8; collections 449.9; collection page members 218; series 310.4; publishers 184; recommenders 152; places 308.4; taxonomy 152.5; dashboard 538.8 / 380.5 / 148.5). Cover chips: status 16×16 at 4px from the top, bottom chips 16×16 at 4px from the bottom. Typecheck, lint and 555 tests pass.
