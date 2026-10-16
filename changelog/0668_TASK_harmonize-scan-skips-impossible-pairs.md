# Task 0668: Harmonize no longer compares records that can never pair

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-807. This was found in the review of 0663 (`findings/review-pr-367.md`). With 3,000 books, `/harmonize` took about 1 s of server time, against its 1,000 ms budget.

Nearly all of that was the scan in `scanDataset` (`src/lib/harmonization/engine.ts`), not the database: the one dataset read took 110 to 170 ms. Its duplicate check groups records by name and by every one-letter deletion of the name, then compares every pair in a group. Editions only pair within one book, language, binding and year, and titles only when their numbers match. But the groups mixed all books, so many editions with one common title ("Second edition", "Poems") made a pair for every two of them, each then ruled out.

## Implementation Details

- A duplicate group now holds only records of one scope (for editions: the book, language, binding and year) and one number signature. Records that differ in either were always ruled out, so the same pairs are found and every finding is unchanged; there are just far fewer pairs to rule out.
- The scope and number signature of each record are worked out before the groups are built, instead of after.
- Fingerprints are unchanged, so dismissed findings stay dismissed.
- No migration and no new package.

## Completion Notes

- **Same findings.** The old and new scans ran side by side:
  - on the 3,000-book dataset below: 11,725 findings, identical byte for byte (keys, fingerprints, records, evidence and order);
  - on 40 seeded random catalogues built to be full of near-duplicates (accents, one-letter typos, numbers, roman numerals, comma name order, shared identifiers, and scopes that partly match): 301,150 findings, 228,396 of them duplicates, identical byte for byte.
- **Time** on the seeded production preview with the 0663 review's seed scaled to 3,026 books and 3,349 editions:
  - the scan alone: about 1,000 ms before, about 530 ms after;
  - `/harmonize` server time, median of 7: 1.39 s before, 0.81 s after.
- **A worse case:** 3,000 editions titled "Second edition", one per book. The old scan takes 90 s to find nothing; the new one takes under 0.3 s.
- **Test** (`harmonization/engine.test.ts`): that case, with a misspelt edition of one of the books ("Second editon") still paired with it, and an edition of that book in another language left apart. The harmonization suite passes (46 tests).
- `pnpm typecheck` is clean, and ESLint on `engine.ts` is clean.
