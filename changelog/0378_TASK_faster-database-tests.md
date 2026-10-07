# Task 0378: Three database tests no longer use most of Vitest's 5 s limit

**Status**: Completed
**Created**: 2026-10-07
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-538. On a 4-CPU cloud machine, three database tests took 3.2 to 4.9 s
of Vitest's 5 s limit, and one timed out once under load. Each now does the
same checks in far less time inside the test. No limit is raised, and no
app code changes.

## Implementation Details

Where the time went, measured on the Mac with a log line after each step:

- **`perfume-sources.test.ts`**, "keeps a different value and a locked
  source as they are" (4.0 s here, 4.0 s on the cloud machine). Each review
  and each apply waited about 1 s: the Wikidata adapter keeps the 1 s gap
  between calls that Wikidata's terms ask for, and the test's Wikidata is a
  stub. The file now mocks `@/lib/providers/wikidata-perfumes` with the same
  adapter and a 0 ms gap. The gap itself stays tested in
  `src/__tests__/providers/contract.test.ts` and
  `src/__tests__/utils/external-fetch.test.ts`, and
  `src/__tests__/catalogue/perfume-sources.test.ts` pins the adapter's gap at
  1,000 ms.
- **`media-ingest.test.ts`**, "serves every author image in monochrome:
  portrait, background and gallery" (1.0 s here, 4.9 s on the cloud
  machine). The time is in encoding the pictures. The three pictures that
  check the colour rule are 400 x 225, not 1600 x 900: the rule does not
  depend on size (render 13 ms, not 110 ms, each). The picture that checks
  the background's size is 2600 x 1300, not 4000 x 2000: just over the
  2,560 px limit, it still comes out at 2,560 x 1,280.
- **`ebook-catalogue.test.ts`**, "makes the location on a database without
  one" (0.9 s here, 3.2 s on the cloud machine). All of it was running every
  migration on an empty schema, which is the test's setup. That now runs in
  a `beforeAll` with a 60 s limit, as the file's "the tables" block already
  does; the test checks the location and the setting it points at. The
  file's two other migration tests, "stops, changing nothing, while the old
  library holds anything" and "renames the digital location in place",
  spent most of their time the same way: running every migration up to the
  guards. That now runs in a `beforeEach` with a 60 s limit, and each test
  runs only the last migrations.

## Completion Notes

- The three files alone, on the Mac, before and after:
  - `perfume-sources.test.ts`: 14.2 s, now 2.7 s for its 6 tests; the named
    test no longer shows among the tests over 300 ms.
  - "serves every author image in monochrome": 1,036 ms, now 661 ms.
  - "makes the location on a database without one": 861 ms; it no longer
    shows among the tests over 300 ms.
- Every expectation in the three tests is the same as before.
- Typecheck clean. Lint: no new warning.
- `scripts/qa/test-local.py`: 262 files, 2,953 tests, all passed.
