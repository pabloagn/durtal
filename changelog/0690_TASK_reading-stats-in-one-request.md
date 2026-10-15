# Task 0690: Reading stats in one request per wave

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

From the second loading audit (`findings/audit-loading-2-2026-10-15.md`,
finding 1): `/reading/stats` sent about 35 queries, 22 of them at once, each
its own HTTP request to Neon, and waited three round trips. Same numbers,
fewer requests and one round trip less.

## Implementation Details

- `src/lib/db/read-batch.ts` (new): `batchedRows(query)`. Every read
  started in the same turn of the event loop joins one `db.batch`, which the
  Neon HTTP driver sends as one request; each caller gets its own rows,
  parsed exactly as `db.execute` parses them. One failing read fails its
  batch. A driver without `batch` runs each read alone.
- `src/lib/reading/stats.ts`: every read goes through `batchedRows`. Three
  reads that waited for an earlier one now go with it: all time's undated
  count, the ratings' "higher on reread", and the unread pile's homes, which
  come from the at-hand query itself (active physical locations by name, as
  `homeOptions` picks them) instead of a locations read first.
- Docs: `docs/06_SERVER_ACTIONS.md`, Reading stats.
- Test: `src/__tests__/db/read-batch.test.ts`.

## Completion Notes

Production build, local preview with the synthetic catalogue, 20 demo books
and the reading journey seed, each HTTP request to the database held 800 ms
(as one Neon round trip):

| `/reading/stats` | Requests | Queries | Time |
| --- | --- | --- | --- |
| This year, before | 35 | 35 | 2.47 s |
| This year, after | 3 | 34 | 1.71 s |
| All time, before | 33 | 33 | 2.47 s |
| All time, after | 2 | 32 | 1.69 s |

The page's text is the same before and after for this year and all time
(the HTML outside its scripts, compared byte for byte). The reading stats
suites (`integration/reading-stats`, `ui/reading-stats`) pass on a
disposable database.
