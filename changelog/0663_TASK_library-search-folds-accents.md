# Task 0663: Library search ignores accents in titles, series and publishers

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0660
**Blocks**: None

## Overview

SLN-765. This was found in the review of 0660 (`findings/review-pr-344.md`).

The library list's search ignored accents only for authors:
- "a rebours" did not find "À rebours";
- an accent-free series name did not find its series;
- "editions de minuit" found nothing, while "Éditions de Minuit" and "minuit" did.

The command palette already folded titles.

## Implementation Details

- `textMatches` (`src/lib/actions/works.ts`) checks whether a text contains the search in either of two ways:
  - as typed (`ilike`, as before);
  - with accents, case and punctuation folded on both sides by `search_normalize`, as author names already are.
- It is used for:
  - the title;
  - the series name and the series record;
  - the edition's publisher text;
  - the publisher record and its aliases.
- Every match from before stays, because the plain match is kept.
- A search of punctuation alone ("—", "%") folds to nothing. It keeps the plain match only, so it never matches every book.
- The matches stay inside the list's one query (0660), so a search adds no round trip.
- No migration and no index. The fold runs over the books in the same scan as before (see the timing below).

## Completion Notes

- **Test** (`integration/library-filters.test.ts`): it checks that a search finds:
  - titles without their accents, in capitals and as typed ("a rebours", "l oeuvre", "la bas");
  - a series name and a series record;
  - the publisher text, a publisher record and its alias;
  - with the list and its count agreeing.
  - It also checks that punctuation is still matched as typed, and that alone it matches nothing extra.
  - Run against main's code, the test fails at its first check ("a rebours" finds nothing).
- **Same results as before.** Main's `works.ts` ran beside this one on the same database: a disposable PostgreSQL 16 loaded with the 0660 review's seed (`findings/review-344-seed.sql`, 420 books).
  - There were 246 searches: every title, author, publisher, alias and series as written, in capitals, without accents and cut short, plus ISBNs whole, partial and hyphenated, digit runs, punctuation and nonsense.
  - Over 4,108 checks, no book that main found was lost, and no list or count changed order where nothing was added.
  - Twenty searches found more, each by its accents: "a rebours", "la bas", "ete", "aegir", "oeuvres", "editions de minuit", "serie", and "a" finding "À rebours". "é" now finds every "e", as an author search already did. "100%" also finds "Noon 100": the "%" folds away, as it does for authors.
- **Timing** on the seeded production preview with the same seed, each database round trip held at 800 ms (audit-only, not committed):

  | Search | Page, main | Page, this change | Database time for the list and count, main | This change |
  | --- | --- | --- | --- | --- |
  | borges | 2.47 s, 3 waves | 2.48 s, 3 waves | 10.6 ms | 20.6 ms |
  | 97800 (partial ISBN) | 2.47 s, 3 waves | 2.47 s, 3 waves | 10.6 ms | 27.6 ms |
  | a | | | 16.3 ms | 18.6 ms |
  | editions de minuit | 0.82 s, nothing found | 2.47 s, 43 books | 10.1 ms | 19.8 ms |

  - A search still sends no query of its own: the waves are the list and its count, then the cards' extras.
  - The fold costs 2 to 17 ms of database time on 440 books, against an 800 ms round trip here.
- **Page weight:** every route is within budget (`/library` 277 of 300 KB with the 440-book seed).
- `pnpm typecheck` is clean, and ESLint on `works.ts` is clean. The library filters database suite passes (13 tests).
