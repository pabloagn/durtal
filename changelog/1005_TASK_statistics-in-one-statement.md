# Task 1005: The library statistics read in one statement

**Status**: Completed
**Created**: 2026-10-20
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 1001 (SLN-1311)
**Blocks**: None

## Overview

SLN-1315, from the query-indexes survey (findings/query-indexes.md, section 4). Every library statistic was its own statement, and each one rebuilt the same `held` CTE over instances, editions and works: 15 statements on /statistics, 4 on the dashboard. The busiest years waited for the written years, a second round trip. The cover-colour backfill wrote one row per round trip.

## Implementation Details

- `lib/statistics/library.ts`:
  - One exported read, `libraryStatistics(parts, { busiest })`, sends one statement: `with held, owned, held_editions, written, writers` once, then each part the page asks for as one JSON column (`json_agg` for lists, `row_to_json` for a row).
  - The parts: `numbers`, `written`, `busiest`, `favourites`, `rankings`, `breakdown`, `ratings`, `copies`, `extremes`. Each keeps its old SQL and its old shape; a `read` turns its JSON back into the old types (the ten half-star rows, the undated counts, numeric extremes).
  - The busiest years are chosen in SQL from `written` (the top years with at least two books), so they no longer wait for the years to come back.
- /statistics reads all nine parts with its other reads; the dashboard's Statistics section reads `numbers`, `written`, `breakdown` and one busiest year.
- `lib/color/backfill.ts`: stored palettes' buckets go out as one `update … from (values …)` per 500 rows (`PER_UPDATE`), not one update per row.

## Completion Notes

Measured on private previews of the production build with the 5,000-book scale seed (`scripts/qa/seed-scale.sql`), main and this change built from the same tree, each request held 0, 40 or 200 ms at the bridge. Best to worst of five:

| Page | Main, 0 / 40 / 200 ms | Now, 0 / 40 / 200 ms |
| --- | --- | --- |
| /statistics | 0.11-0.14 / 0.18-0.20 / 0.51-0.53 s | 0.12-0.13 / 0.14-0.15 / 0.31-0.33 s |
| Dashboard | 0.11-0.13 / 0.17-0.20 / 0.49-0.53 s | 0.12-0.18 / 0.16-0.18 / 0.49-0.50 s |

- /statistics loses its second round trip. The dashboard's wall time is set by its other reads, which take two round trips either way (task 0896).
- Database time, every statement the request sends: /statistics 239-274 ms in 15 statistics statements → 93-106 ms in one; the dashboard 136-176 ms with 4 → 105-141 ms with one.
- The one statement's planned cost on that seed is 5,650 (`auto_explain`), far under `jit_above_cost` (100,000), so it runs with JIT as Neon sets it. A part list with nothing in it returns nothing without a query.
- **Same numbers:** main and this change give the same text on /statistics (2,663 characters) and the dashboard (3,679), the same 205 links on the dashboard and the same 83 on /statistics, except the two location ids, which each preview seeds afresh.
- **Tests:**
  - `library-statistics` (DB) reads each part as the pages do, with its old expectations.
  - `library-filters` (DB): stored palettes write the same buckets in one statement per 500 rows.
  - `dashboard-reads`: the dashboard sends one read with the busiest year in it, before it waits on anything.
  - The page tests mock the one read.
- **Checks:** `pnpm typecheck` and `pnpm lint` clean, `pnpm test:local` and `pnpm build` pass. The browser audit passes 18 of 18 page loads on /statistics and the dashboard (Chromium, Firefox and WebKit at 1440 and 390). `page-weight.js` passes.
