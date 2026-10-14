# Task 0534: Harmonize page speed at 6,000 e-books

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0533 (reading page speed)
**Blocks**: None

## Overview

SLN-690 follow-up. On the 6,000 e-book seed, /harmonize took 1.0 to 1.3 s
against its 1,000 ms budget row. The database part is 140 ms; the rest was
the scan in `scanDataset`, 700 to 1,070 ms.

The seed's books are titled "Seed Library Book 1443" and so on. The
duplicate check's deletion keys find names one character apart, so two
titles that differ by one digit share a key: tens of thousands of pairs,
each of which rebuilt both records' identifier lists, normalized their
scope fields and computed both number signatures before the differing
numbers rejected it. A real catalogue has numbered titles too (volumes,
parts), fewer of them.

## Implementation Details

`src/lib/harmonization/engine.ts`, the duplicate pair loop:

- Each record's identifiers, number signature and normalized scope values
  are computed once per scan, not once per pair.
- Different number signatures reject a pair first, before the pair key is
  built. Every test in the loop is pure, so the order changes no finding.
- The "Various", "Unknown" test is one function at module level, no longer
  rebuilt per pair.
- `sameScope` stays, for merges.

## Completion Notes

- On the 6,000 e-book seed the scan takes 330 to 500 ms instead of 670 to
  950 ms, measured side by side on the same data, with the same 6,021
  findings, byte for byte.
- /harmonize on that seed: 0.6 to 0.9 s instead of 1.0 to 1.3 s, under its
  1,000 ms row, with another test run sharing the machine's 4 cores.
- A unit test scans 3,000 numbered titles plus one misspelling of one of
  them, and finds exactly that pair.
