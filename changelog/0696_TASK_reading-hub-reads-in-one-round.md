# Task 0696: The reading hub reads in one round

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-837. `/reading` waited on the database three times in a row, and
`/reading/suggestions` twice. The suggestions read the places first, only to
check the remembered home, and then everything else; the open readings read
their rows, then their e-book links; the reading-time estimates waited for
all of it, though they need only the readings in progress.

## Implementation Details

- `src/lib/reading/suggest/context.ts`: `getSuggestionContext` reads the
  places, the books, the settings, the pace priors and Up Next's length at
  once. The books are read with the remembered home (when it is a well-formed
  id) and read again without it only when it is not a home now.
- `src/lib/actions/reading.ts`: `getOpenReadings` reads the readings and their
  reader links together (`getReaderLinksForOpenReadings` in
  `src/lib/ebooks/queries.ts` selects the open readings' works in SQL).
  `getPaceContext("reading")` reads every reading in progress without their
  ids; `readingEstimates` passes it through.
- `src/app/(catalogue)/reading/(tabs)/page.tsx`: the estimates run with the
  hub's other reads.
- The dashboard and the command palette also get the open readings in one
  round. No batching: requests stay the same, sent in parallel.

## Completion Notes

Production build, local preview from one database dump (synthetic catalogue,
reader fixtures, 20 demo books, the reading journey), on main 1fc6a25a. Each
HTTP request to the database held 40 ms or 200 ms (one Neon round trip):

| Page | Rounds | 40 ms | 200 ms |
| --- | --- | --- | --- |
| `/reading`, main | 3 | 0.19-0.21 s | 0.66 s |
| `/reading`, this change | 1 | 0.12 s | 0.26 s |
| `/reading/suggestions`, main | 2 | 0.13 s | 0.43 s |
| `/reading/suggestions`, this change | 1 | 0.08 s | 0.23-0.25 s |

The dashboard is no slower (1.29 s at 200 ms, main 1.30 s).

- Same pages as main: the rendered DOM of `/reading` and
  `/reading/suggestions` is identical with no remembered home, with a home,
  with a digital location remembered (not a home) and with a malformed
  cookie.
- Browser audit (alignment, design, overflow, touch): 18 of 18 in Chromium,
  Firefox and WebKit at 1440, 390 and 320. Page weight: `/reading` 115 of
  300 KB, `/reading/suggestions` 137 of 300 KB.
