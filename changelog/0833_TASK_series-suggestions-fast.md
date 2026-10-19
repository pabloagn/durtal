# Task 0833: Series suggestions without the JIT stall

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-940, from the scale-pages survey (findings/scale-pages-survey-2026-10-16.md). At 5,000 books the series-suggestions query planned at a cost of 533,000, over `jit_above_cost` (100,000, which the live database keeps), so Postgres spent about 500 ms JIT-compiling an answer that takes 50 ms. `/series` took 1.0 s at 200 ms of latency, and `/settings/data` could not send its first byte until the suggestions were ready.

## Implementation Details

- `getSeriesSuggestions` (`src/lib/actions/series.ts`): each suggestion's authors came from a subquery run once a matched row. The planner has no statistics for the normalized title join and guesses 30,000 matches, so it costed that subquery 30,000 times. The authors now come from one grouped join over `work_authors`, which plans at 25,000. The answer is unchanged: compared row for row on the scale seed with series named "A, B, and C", "Trilogy: A and B", a single title and a book already in a series.
- `/settings/data`: `reviewQueueCounts` splits into `identifyQueueCount` (read with the page) and `seriesSuggestionCounts`, which `SeriesQueueRow` reads inside a Suspense boundary. While it streams, the row shows a skeleton line the width of its count, so Open does not move on a phone.
- No database setting changes.

## Completion Notes

Measured on the 5,000-book scale seed (`--seed-large 400` plus the survey's seed-scale.sql), median of three, with the local bridge delaying each query:

| Route | Before, 40 / 200 ms | After, 40 / 200 ms |
|---|---|---|
| `/series` total | 646 / 1,018 ms | 168 / 646 ms |
| `/settings/data` first byte | 657 / 759 ms | 77 / 234 ms |
| `/series/suggestions` total | 688 / 985 ms | 166 / 481 ms |

The query alone: 510 to 680 ms with JIT before, 60 ms after (52 ms before with JIT off). Audits clean on `/settings/data`, `/series` and `/series/suggestions` in Chromium, Firefox and WebKit at 1440, 390 and 320; page weight passes. Test: `src/__tests__/ui/settings-data-streams.test.ts`.
