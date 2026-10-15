# Task 0706: The series page reads the database in two waves, not four

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-797, from the speed survey (findings/speed-survey-2026-10-15.md): the
series page asked which volumes have an e-book only after "Next to read"
was done, and "Next to read" read its copy, the catalogue status and the
reading day one after another.

## Implementation Details

- `src/app/(catalogue)/series/[id]/page.tsx`: `catalogueAvailability`
  chains off the series alone, inside the page's one `Promise.all`.
- `getSeriesNextToRead` (`src/lib/actions/reading.ts`): after the next
  volume, its copy, its catalogue status and today's reading day load
  together.

## Completion Notes

Measured on a production preview of a disposable seed with every database
request held 200 ms (a temporary local bridge change, not committed), on
the third load of a four-volume series:

| | Waves | Requests | Page |
| --- | --- | --- | --- |
| Before | 4 | 7 | 0.85 s |
| After | 2 | 4-5 | 0.44 s |

"Next to read" shows the same volume and whereabouts.
