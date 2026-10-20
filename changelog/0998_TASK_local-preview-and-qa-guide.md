# Task 0998: A guide to the local preview and the QA audits, and valid seeded device ids

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0997
**Blocks**: None

## Overview

SLN-1270, from findings/docs-drift.md (section 2, ticket 4). Nothing documented the local preview or the audits CLAUDE.md requires, the valid-UUID seed rule from SLN-1167 was written nowhere, the valid 5,000-book scale seed lived only in findings/, and `seed-places.sql` made device ids that `z.uuid()` refuses.

## Implementation Details

- **docs/12, "Local Preview and QA".** What the preview does and refuses, every `preview-local.py` flag, the scale seed and how to apply it, the seed rule, the five in-page audits with what each finds and when it passes, and the command-line checks (`page-weight.js` with a pointer to `page-weight.json` and the heavy config, `phone-audit.mjs`, `interaction-audit.mjs`, `journeys.mjs`) with their command lines.
- **`scripts/qa/seed-scale.sql`**, from findings/scale-recheck-records-2026-10-18/seed-scale-valid.sql. It holds only synthetic rows. Its ids come from a named `pg_temp.seed_uuid()` that builds a version-4 id from a name, in place of the old trick of shadowing `md5()`. The step that re-keyed collections, series and venues with `gen_random_uuid()` is gone, because their ids are already valid. The 700-edition publisher stays.
- **`scripts/qa/seed-places.sql`** gives each seeded device `gen_random_uuid()`.

## Completion Notes

- No file under `scripts/qa/` casts `md5(…)` to uuid. `seed-heavy-book.sql`'s `vu()` builds version-4 ids from `md5` the same way `seed_uuid` does; both pass `z.uuid()`.
- On a fresh preview (`--start --s3-dir DIR --seed-reader --seed-places 50`): "Seeded 50 places", and all 50 device ids pass `z.uuid()`. `seed-scale.sql` then seeded 5,000 books, 60 collections, 600 venues and 728 editions for Scale House 1. The first 200 work ids pass `z.uuid()`. /library, /library/scale-book-6, /collections, /series and /places answer 200.
- The path check from 0997 finds no missing path.
- Rechecked on main after #605: every documented flag matches `preview-local.py --help`, the journeys line names the journeys the file now holds, and on a fresh `--start` preview `seed-scale.sql` loaded in 24 s (5,006 books, 1,503 people, 250 series, 60 collections, 601 venues), every work id is a version-4 UUID, and a seeded series, collection and book open with 200.
- The reading seed's page totals (the ticket's 19 Oct addition) were already right: SLN-1309 made `seed-reading-scale.sql` write `start_percent` and `end_percent`. On a fresh preview with `seed-scale.sql` and then `seed-reading-scale.sql`, /reading/stats?year=2024 reads "208,759 pages in all", and a direct SQL sum of the year's sessions' pages gives 208,758 (each session rounded apart). The seed's header now names `scripts/qa/seed-scale.sql` in place of the findings copy.
