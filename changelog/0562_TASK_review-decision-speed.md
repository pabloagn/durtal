# Task 0562: Review decisions stay quick on 6,000 eBooks

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0560
**Blocks**: None

## Overview

SLN-691 follow-up. With 0560 the review decisions worked on a library of
6,000 eBooks, but each took most of ten seconds: Keep as eBook prepared in 7
to 12 s and confirmed in about 9.5 s, as did Choose a book's Preview and
Confirm. Joris's first import of his eBook library sends about 80 books to
review. Every decision reads, hashes and copies the whole matching catalogue
(31 MB of rows on the 6,000 eBook preview), and most of the time went to doing
that more often than needed.

## Implementation Details

Profiled on the 6,000 eBook preview (`preview-local.py --ebooks 6000
--seed-review`), a Keep decision at a time:

- `src/lib/ebooks/match/load.ts`: building the catalogue filtered every child
  table (files, editions, credits, copies, aliases, identifiers, series) once
  per parent row, which is quadratic: about 3 s of each prepare. Each table is
  now grouped once. The order of every list is the table's order, as before.
- `src/lib/ebooks/match/load.ts`, `conditions.ts`, `keys.ts`: a file with a
  legacy key (`files/<sha>.<ext>`) validated the whole server environment
  twice to read `EBOOKS_PREFIX`, about 1.4 s per catalogue read and 3 s per
  decision on 6,000 such files. A catalogue reads the prefix once and passes
  it to `isEbookFileDownloadableWithPrefix` and
  `isEbookFileNativeReadableWithPrefix`; the one-argument checks are
  unchanged. If the environment is invalid, every file is still blocked.
- `src/lib/ebooks/match/load.ts`: the rows are read as the database's JSON
  text, parsed and sealed (deeply frozen) in place, and each table's SHA-256
  over that text is kept beside the frozen rows. `loadMatchRows` is the row
  read on its own.
- `src/lib/ebooks/match/guards.ts`: a writer's guard for a table read that way
  has the database hash the table under lock and compare it to the kept hash,
  rather than receiving all 31 MB of rows as a parameter and comparing them as
  jsonb (1.6 s down to 0.7 s). The hash covers the same rows in the same order,
  so any change is still refused with "Matching snapshot changed in ...".
  Rows from anywhere else are compared as before.
- `src/lib/ebooks/match/writer-input.ts`: a sealed value is shared by a later
  writer-input copy instead of copied again (the rows were copied two or three
  times per decision, 0.6 s each). `sealParsedJson` seals freshly parsed rows
  in place, about a sixth of a copy.
- `src/lib/ebooks/review/preview.ts`: storing a preview hashes each table's
  canonical text once and reuses it for the whole envelope's hash. Tables read
  with the database's hash use it as their digest, so the confirm's reread no
  longer hashes 31 MB in JavaScript.
- `src/lib/ebooks/review/receipts.ts`: `canonicalReviewJson` takes text it
  already has for a value. Every hash is unchanged.

## Completion Notes

- Keep on the 6,000 eBook preview, three in a row: prepare 7.2 s before,
  about 3.9 s now; confirm 8.2 s before, about 2.6 s now.
- On the scale suite's library (6,000 eBooks with legacy keys and 4 KB of
  metadata per file): a keep prepared in 14.0 s before the prefix change and
  2.1 s after; it confirms in 1.8 s.
- Tests: `ebook-review-scale.test.ts` gains a timing row (a keep prepares in
  under 6 s and confirms in under 4.5 s on 6,000 eBooks with 4 KB of metadata
  per file) and a guard test (the kept hash equals the database's for every
  table, an unchanged library passes, a changed title is refused). New
  `writer-input.test.ts`; `review-receipts.test.ts` checks reused text gives
  the same canonical JSON. `load.test.ts` reads rows as text.
- Not covered: the plan hash (`hashMatchingPlan`) and the preview's envelope
  hash still walk all rows once each per decision, and every decision still
  reads the whole catalogue twice. Making plans hold per-table hashes instead
  of rows would remove most of what is left, but changes every matching plan.
